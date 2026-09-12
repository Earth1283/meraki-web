// Turning in an assignment, or saving progress on it, the way the official
// site does. The rules are in submission.js; this is the panel and the writes.
import { el } from './dom.js';
import * as api from './api.js';
import { state, closeOverlay, openDetailFor, refresh, notify } from './state.js';
import { showToast } from './toast.js';
import { sidePanel } from './panels.js';
import { turnInProblem, turnInWrite, submissionStoragePath } from './submission.js';
import { formatBytes, submissionForAssignment } from './rows.js';
import { t } from './i18n.js';

/** Uploads a new file first (to storage, then its file_uploads row), then
 * updates this student's submission for the assignment or creates it. The
 * submission is looked up fresh rather than taken from state.data, whose
 * submissions may not have paged back that far: a second submission row for
 * the same assignment would be worse than one extra request. */
export async function turnIn(assignment, { body, file, final }) {
  const studentId = state.ownStudentId;
  if (!studentId) throw new Error(t('turnin.noStudentRecord'));
  const [existing] = await api.getTable('assignment_submissions', `select=id,status,file_upload_id&assignment_id=eq.${assignment.id}&student_id=eq.${studentId}`);
  const problem = turnInProblem({ studentId, final, body, file, existing });
  if (problem) throw new Error(t(problem));

  let fileUploadId = existing?.file_upload_id ?? null;
  if (file) {
    const path = submissionStoragePath(assignment.id, studentId, file.name);
    await api.uploadFile(path, file);
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
        uploaded_by: state.ownUserId,
      },
      { returnId: true },
    );
  }

  const write = turnInWrite({ assignmentId: assignment.id, studentId, existing, body, fileUploadId, final });
  if (write.op === 'update') await api.updateRow('assignment_submissions', write.id, write.data);
  else await api.insertRow('assignment_submissions', write.data);
  await refresh();
}

// What's typed into the panel, per assignment. Every notify() rebuilds the
// open overlay, and a half-written response mustn't vanish when that happens
// (or when the panel is closed by accident). Dropped once the work is saved.
const drafts = new Map();

function draftFor(assignment, submission) {
  if (!drafts.has(assignment.id)) {
    drafts.set(assignment.id, { body: submission?.body ?? '', file: null, saving: false, error: null, focused: false, caret: null });
  }
  return drafts.get(assignment.id);
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
    const current = submission?.file_uploads?.file_name;
    if (draft.file) fileNote.textContent = t('turnin.newFile', { name: draft.file.name, size: formatBytes(draft.file.size) });
    else if (current) fileNote.textContent = t('turnin.currentFile', { name: current });
    else fileNote.textContent = t('turnin.fileHint');
  };
  fileInput.addEventListener('change', () => {
    draft.file = fileInput.files?.[0] ?? null;
    showFile();
  });
  showFile();

  const save = (final) => {
    const problem = turnInProblem({ studentId: state.ownStudentId, final, body: draft.body, file: draft.file, existing: submission });
    draft.error = problem ? t(problem) : null;
    if (!problem) draft.saving = true;
    notify();
    if (problem) return;
    turnIn(assignment, { body: draft.body, file: draft.file, final }).then(
      () => {
        drafts.delete(assignment.id);
        afterSaving();
        showToast(t(final ? 'turnin.turnedIn' : 'turnin.draftSaved'));
      },
      (err) => {
        draft.saving = false;
        draft.error = t('turnin.failed', { msg: err.message });
        notify();
      },
    );
  };

  const draftBtn = el('button', { class: 'btn btn-ghost', type: 'button', disabled: draft.saving, onclick: () => save(false), text: t('turnin.saveDraft') });
  const finalBtn = el('button', {
    class: 'btn btn-primary',
    type: 'submit',
    disabled: draft.saving,
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
        assignment.due_date ? el('span', { class: 'turnin-due', text: t('field.due', { date: assignment.due_date }) }) : null,
      ]),
      assignment.description ? el('p', { class: 'detail-body turnin-instructions', text: assignment.description }) : null,
      el('label', { class: 'field-label', text: t('turnin.bodyLabel') }),
      body,
      el('label', { class: 'field-label', text: t('turnin.fileLabel') }),
      fileInput,
      fileNote,
      draft.error ? el('p', { class: 'form-error', role: 'alert', text: draft.error }) : null,
      el('div', { class: 'panel-actions' }, [draftBtn, finalBtn]),
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
