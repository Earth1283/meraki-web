// Turning in an assignment, or saving progress on it, the way the official
// site does. The rules are in submission.js; this is the panel and the writes.
import { el } from './dom.js';
import * as api from './api.js';
import { state, closeOverlay, openDetailFor, refresh, notify, subscribe } from './state.js';
import { showToast } from './toast.js';
import { sidePanel } from './panels.js';
import { turnInProblem, turnInWrite, submissionStoragePath, canTurnIn, MAX_UPLOAD_BYTES } from './submission.js';
import { formatBytes, formatDate, submissionForAssignment } from './rows.js';
import { t } from './i18n.js';
import { readDraft, writeDraft, removeDraft, saveDraftFile, loadDraftFile, createDraftSync, draftSyncPreferences, onDraftSyncPreferences } from './drafts.js';
import { saveCloudDraft } from './draftcloud.js';
import { buildDraftNote } from './draft-controls.js';

/** Uploads a new file first (to storage, then its file_uploads row), then
 * updates this student's submission for the assignment or creates it. The
 * submission is looked up fresh rather than taken from state.data, whose
 * submissions may not have paged back that far: a second submission row for
 * the same assignment would be worse than one extra request. */
export async function turnIn(assignment, { body, file, final }) {
  const studentId = state.ownStudentId;
  const userId = state.ownUserId;
  const checkAccount = () => { if (api.getSession()?.user_id !== userId) throw new Error(t('drafts.accountChanged')); };
  checkAccount();
  if (!studentId) throw new Error(t('turnin.noStudentRecord'));
  const [existing] = await api.getTable('assignment_submissions', `select=id,status,file_upload_id&assignment_id=eq.${assignment.id}&student_id=eq.${studentId}`);
  checkAccount();
  if (!canTurnIn(assignment, existing)) throw new Error(t('drafts.locked'));
  const problem = turnInProblem({ studentId, final, body, file, existing });
  if (problem) throw new Error(t(problem));

  let fileUploadId = existing?.file_upload_id ?? null;
  if (file) {
    const path = submissionStoragePath(assignment.id, studentId, file.name);
    await api.uploadFile(path, file);
    checkAccount();
    fileUploadId = await api.insertRow(
      'file_uploads',
      {
        class_id: assignment.class_id,
        student_id: studentId,
        audience: 'teachers',
        title: `${assignment.title} — submission`,
        storage_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
      },
      { returnId: true },
    );
    checkAccount();
  }

  const write = turnInWrite({ assignmentId: assignment.id, studentId, existing, body, fileUploadId, final });
  if (write.op === 'update') await api.updateRow('assignment_submissions', write.id, write.data);
  else await api.insertRow('assignment_submissions', write.data);
  checkAccount();
  await refresh();
}

// What's typed into the panel, per assignment. Every notify() rebuilds the
// open overlay, and a half-written response mustn't vanish when that happens
// (or when the panel is closed by accident). Dropped once the work is turned in.
const drafts = new Map();

function persist(draft, assignmentId) {
  draft.localFailed = !writeDraft(draft.userId, 'assignment', assignmentId, {
    body: draft.body, fileName: draft.file?.name ?? (draft.loadingFile ? draft.recoveryFileName : draft.missingFile) ?? null,
    cloudDirty: draft.sync.status.dirty, syncedAt: draft.sync.status.syncedAt,
  });
  draft.updateStatus?.();
}

// Switching accounts clears memory and timers; saved drafts stay scoped to
// their owner and are recovered only when that same account signs in again.
subscribe(() => {
  for (const [key, draft] of drafts) {
    if (draft.userId !== state.ownUserId) { draft.sync.stop(); drafts.delete(key); }
  }
});
onDraftSyncPreferences((userId, prefs) => {
  for (const draft of drafts.values()) if (draft.userId === userId) draft.sync.configure(prefs);
});

function draftFor(assignment, submission) {
  const key = `${state.ownUserId}:${assignment.id}`;
  if (!drafts.has(key)) {
    const saved = readDraft(state.ownUserId, 'assignment', assignment.id);
    const draft = {
      userId: state.ownUserId, body: typeof saved?.body === 'string' ? saved.body : submission?.body ?? '',
      file: null, saving: false, error: null, focused: false, caret: null,
      recovered: !!saved, loadingFile: !!saved?.fileName, missingFile: null,
      recoveryFileName: saved?.fileName,
      fileRevision: 0, pendingFile: Promise.resolve(),
    };
    draft.sync = createDraftSync({
      preferences: draftSyncPreferences(draft.userId),
      snapshot: () => ({ body: draft.body, file: draft.file }),
      active: () => api.getSession()?.user_id === draft.userId && !draft.saving && !draft.loadingFile && !draft.missingFile && canTurnIn(assignment, submissionForAssignment(state.data, assignment.id)) && !['submitted', 'collected'].includes(submissionForAssignment(state.data, assignment.id)?.status),
      write: async (value) => {
        const row = await saveCloudDraft({ assignment, studentId: state.ownStudentId, userId: draft.userId, ...value });
        const previous = submissionForAssignment(state.data, assignment.id);
        const next = { ...previous, ...row, assignment_id: assignment.id };
        if (value.file) next.file_uploads = { id: row.file_upload_id, file_name: value.file.name };
        if (previous) Object.assign(previous, next);
        else state.data.assignmentSubmissions.push(next);
        if (value.file && draft.file === value.file) {
          draft.file = null;
          draft.pendingFile = draft.pendingFile.catch(() => {}).then(() => saveDraftFile(draft.userId, assignment.id, null)).catch(() => {});
        }
      },
      changed: () => { if (draft.sync) persist(draft, assignment.id); },
    });
    draft.sync.status.syncedAt = saved?.syncedAt ?? null;
    drafts.set(key, draft);
    persist(draft, assignment.id);
    if (saved?.cloudDirty) draft.sync.edit();
    if (saved?.fileName) {
      loadDraftFile(draft.userId, assignment.id).then(file => {
        if (draft.fileRevision !== 0) return;
        draft.file = file;
        draft.missingFile = file ? null : saved.fileName;
      }, () => { if (draft.fileRevision === 0) draft.missingFile = saved.fileName; }).finally(() => {
        draft.loadingFile = false;
        draft.sync.configure(draftSyncPreferences(draft.userId));
        if (state.ownUserId === draft.userId && state.activeOverlay === 'turnin' && state.turnInAssignmentId === assignment.id) notify();
      });
    }
  }
  return drafts.get(key);
}

function afterSaving() {
  const back = state.turnInReturn;
  state.turnInReturn = null;
  if (back) openDetailFor(back);
  else closeOverlay();
}

export function buildTurnInForm() {
  const assignment = state.data.assignments.find((a) => a.id === state.turnInAssignmentId);
  if (!assignment) return sidePanel(t('turnin.title'), el('p', { class: 'form-error', text: t('turnin.missing') }));
  const submission = submissionForAssignment(state.data, assignment.id);
  const draft = draftFor(assignment, submission);
  const turnedIn = submission?.status === 'submitted' || submission?.status === 'collected';

  const body = el('textarea', { class: 'field-input textarea turnin-body', rows: 10, placeholder: t('turnin.bodyPlaceholder') });
  body.value = draft.body;
  const keepCaret = () => {
    draft.caret = body.selectionStart;
  };
  body.addEventListener('input', () => {
    draft.body = body.value;
    keepCaret();
    draft.sync.edit();
  });
  body.addEventListener('keyup', keepCaret);
  body.addEventListener('pointerup', keepCaret);
  body.addEventListener('focus', () => {
    draft.focused = true;
  });
  // A re-render takes the text box out from under the cursor, which can blur
  // it too; only a blur that leaves it in the page is the cursor moving on.
  body.addEventListener('blur', () => {
    queueMicrotask(() => {
      if (body.isConnected) draft.focused = false;
    });
  });

  const fileInput = el('input', { class: 'turnin-file-input', type: 'file' });
  const fileNote = el('p', { class: 'turnin-file' });
  const showFile = () => {
    const current = submissionForAssignment(state.data, assignment.id)?.file_uploads?.file_name;
    if (draft.file) fileNote.textContent = t('turnin.newFile', { name: draft.file.name, size: formatBytes(draft.file.size) });
    else if (current) fileNote.textContent = t('turnin.currentFile', { name: current });
    else fileNote.textContent = t('turnin.fileHint');
  };
  fileInput.addEventListener('change', () => {
    const selected = fileInput.files?.[0] ?? null;
    if (!selected) return;
    if (selected.size > MAX_UPLOAD_BYTES) { showToast(t('turnin.tooBig'), 'bad'); fileInput.value = ''; return; }
    draft.file = selected;
    draft.fileRevision += 1;
    draft.loadingFile = false;
    draft.missingFile = null;
    const revision = draft.fileRevision;
    draft.pendingFile = draft.pendingFile.catch(() => {}).then(() => saveDraftFile(draft.userId, assignment.id, selected)).catch(() => {
      if (draft.fileRevision === revision) { draft.fileLocalFailed = true; draft.updateStatus?.(); }
    });
    draft.fileLocalFailed = false;
    draft.sync.edit();
    showFile();
    notify();
  });
  showFile();

  const save = (final) => {
    if (draft.saving || draft.loadingFile || draft.missingFile) return;
    const problem = turnInProblem({ studentId: state.ownStudentId, final, body: draft.body, file: draft.file, existing: submission });
    draft.error = problem ? t(problem) : null;
    if (!problem) { draft.saving = true; draft.sync.stop(); }
    notify();
    if (problem) return;
    const value = { body: draft.body, file: draft.file, final };
    draft.sync.settled().then(() => turnIn(assignment, { ...value, file: draft.file })).then(
      async () => {
        drafts.delete(`${draft.userId}:${assignment.id}`);
        removeDraft(draft.userId, 'assignment', assignment.id);
        await draft.pendingFile;
        await saveDraftFile(draft.userId, assignment.id, null).catch(() => {});
        if (state.ownUserId !== draft.userId) return;
        afterSaving();
        showToast(t(final ? 'turnin.turnedIn' : 'turnin.draftSaved'));
      },
      (err) => {
        draft.saving = false;
        draft.sync.resume();
        draft.error = t('turnin.failed', { msg: err.message });
        notify();
      },
    );
  };

  body.disabled = draft.saving;
  fileInput.disabled = draft.saving;
  const cloud = canTurnIn(assignment, submission) && !turnedIn;
  const draftNote = buildDraftNote(draft, {
    userId: draft.userId, cloud,
    onSync: () => draft.sync.sync().then(() => showFile()),
    onDiscard: async () => {
      draft.sync.stop();
      await draft.sync.settled();
      draft.fileRevision += 1;
      draft.body = submissionForAssignment(state.data, assignment.id)?.body ?? '';
      draft.file = null;
      draft.loadingFile = false;
      draft.fileLocalFailed = false;
      draft.missingFile = null;
      draft.recovered = false;
      draft.sync.status.dirty = false;
      removeDraft(draft.userId, 'assignment', assignment.id);
      await draft.pendingFile;
      await saveDraftFile(draft.userId, assignment.id, null).catch(() => {});
      draft.sync.resume();
      if (state.ownUserId === draft.userId) notify();
    },
  });
  const finalBtn = el('button', {
    class: 'btn btn-primary',
    type: 'submit',
    disabled: draft.saving || draft.loadingFile || !!draft.missingFile || !canTurnIn(assignment, submission),
    text: draft.saving ? t('turnin.saving') : turnedIn ? t('turnin.update') : t('turnin.submit'),
  });

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        save(true);
      },
    },
    [
      el('p', { class: 'turnin-assignment' }, [
        el('strong', { text: assignment.title }),
        assignment.due_date ? el('span', { class: 'turnin-due', text: t('field.due', { date: formatDate(assignment.due_date) }) }) : null,
      ]),
      assignment.description ? el('p', { class: 'detail-body turnin-instructions', text: assignment.description }) : null,
      el('label', { class: 'field-label', text: t('turnin.bodyLabel') }),
      body,
      el('label', { class: 'field-label', text: t('turnin.fileLabel') }),
      fileInput,
      fileNote,
      draftNote,
      draft.error ? el('p', { class: 'form-error', role: 'alert', text: draft.error }) : null,
      el('div', { class: 'panel-actions' }, [finalBtn]),
    ],
  );

  // Into the text box when the panel opens, and back into it after a
  // re-render if that's where the cursor was.
  if (state.turnInFocus || draft.focused) {
    state.turnInFocus = false;
    const caret = draft.caret ?? body.value.length;
    queueMicrotask(() => {
      body.focus();
      body.setSelectionRange(caret, caret);
    });
  }
  return sidePanel(t('turnin.title'), form);
}
