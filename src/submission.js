// Turned-in work: the rules for turning an assignment in (the same ones the
// official site follows), and the "Your work" section of its detail, with
// the teacher's annotations on what was turned in. The writes themselves are
// in turnin.js.
import { el } from './dom.js';
import { pill } from './rows.js';
import { t } from './i18n.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The assignment a grade or assignment row is about, or null. */
export function assignmentForTarget(target, data) {
  if (target.kind === 'assignment') return data.assignments[target.index] ?? null;
  if (target.kind !== 'grade') return null;
  const id = data.grades[target.index]?.assignment_id;
  return id ? data.assignments.find((a) => a.id === id) ?? null : null;
}

/** Whether work can be turned in here: only "online" assignments ("collected"
 * ones are handed in during class, "other" ones scored by the teacher), and
 * never once the teacher has returned it, which the official site locks. */
export function canTurnIn(assignment, submission) {
  return assignment?.submission_mode === 'online' && submission?.status !== 'returned';
}

/** An uploaded file's name made storage-safe, as the official site does it. */
export function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
}

/** Where a turned-in file goes in the school-files bucket. */
export function submissionStoragePath(assignmentId, studentId, fileName, now = Date.now()) {
  return `assignments/${assignmentId}/${studentId}/${now}-${safeFileName(fileName)}`;
}

/** Why work can't be saved yet, as an i18n key, or null. The checks the
 * official site makes before writing anything. */
export function turnInProblem({ studentId, final, body, file, existing }) {
  if (!studentId) return 'turnin.noStudentRecord';
  if (final && !body.trim() && !file && !existing?.file_upload_id) return 'turnin.empty';
  if (file && file.size > MAX_UPLOAD_BYTES) return 'turnin.tooBig';
  return null;
}

/** The submission write for turning work in (`final`) or saving it as a
 * draft: an existing submission is updated (a returned one keeps that
 * status), otherwise one is created. { op: 'update', id, data } or
 * { op: 'insert', data }. */
export function turnInWrite({ assignmentId, studentId, existing, body, fileUploadId, final, now = new Date() }) {
  const status = final ? 'submitted' : 'draft';
  const text = body.trim() || null;
  if (existing) {
    return {
      op: 'update',
      id: existing.id,
      data: { body: text, file_upload_id: fileUploadId, status: existing.status === 'returned' ? 'returned' : status, submitted_at: now.toISOString() },
    };
  }
  return { op: 'insert', data: { assignment_id: assignmentId, student_id: studentId, body: text, file_upload_id: fileUploadId, status } };
}

/** Submission text cut into runs for highlighting annotations: { text,
 * marks, ends }, where `marks` holds the 1-based numbers of the annotations
 * covering the run and `ends` those that end with it. Offsets count
 * characters into the text as the teacher selected it; an annotation whose
 * offsets don't land on its excerpt (the text changed since) is found by
 * searching for the excerpt instead, and left unhighlighted if that fails. */
export function annotationRuns(body, annotations) {
  const ranges = [];
  annotations.forEach((a, i) => {
    const excerpt = a.excerpt ?? '';
    let start = a.start_offset;
    let end = a.end_offset;
    const offsetsFit = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= body.length && body.slice(start, end).startsWith(excerpt);
    if (!offsetsFit) {
      const at = excerpt ? body.indexOf(excerpt) : -1;
      if (at === -1) return;
      start = at;
      end = at + excerpt.length;
    }
    ranges.push({ start, end, n: i + 1 });
  });
  const cuts = [...new Set([0, body.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    runs.push({
      text: body.slice(from, to),
      marks: ranges.filter((r) => r.start <= from && r.end >= to).map((r) => r.n),
      ends: ranges.filter((r) => r.end === to).map((r) => r.n),
    });
  }
  return runs;
}

function chipText(annotation) {
  return annotation.mark_symbol || annotation.mark_code || t('work.markNote');
}

function statusPill(submission) {
  switch (submission?.status) {
    case undefined:
    case null:
      return pill(t('work.notStarted'), 'dim');
    case 'draft':
      return pill(t('work.status.draft'), 'warn');
    case 'submitted':
      return pill(t('work.status.submitted'), 'good');
    case 'collected':
      return pill(t('work.status.collected'), 'good');
    case 'returned':
      return pill(t('work.status.returned'), 'accent2');
    default:
      return pill(submission.status, 'dim');
  }
}

function annotatedBody(body, annotations) {
  return el(
    'p',
    { class: 'detail-body submission-body' },
    annotationRuns(body, annotations).map((run) => {
      if (run.marks.length === 0) return run.text;
      return el('mark', { class: 'annotation-mark', title: run.marks.map((n) => chipText(annotations[n - 1])).join(', ') }, [
        run.text,
        ...run.ends.map((n) => el('sup', { class: 'annotation-ref', text: String(n) })),
      ]);
    }),
  );
}

function annotationList(annotations) {
  return el('div', { class: 'annotations' }, [
    el('div', { class: 'feedback-label', text: t('work.annotations') }),
    el(
      'ol',
      { class: 'annotation-list' },
      annotations.map((a, i) =>
        el('li', { class: 'annotation' }, [
          el('span', { class: 'annotation-n', text: String(i + 1) }),
          el('div', { class: 'annotation-main' }, [
            el('div', { class: 'annotation-head' }, [
              el('span', { class: 'annotation-chip', text: chipText(a) }),
              a.mark_label ? el('span', { class: 'annotation-label', text: a.mark_label }) : null,
            ]),
            a.excerpt ? el('blockquote', { class: 'annotation-excerpt', text: a.excerpt }) : null,
            a.comment ? el('p', { class: 'annotation-comment', text: a.comment }) : null,
          ]),
        ]),
      ),
    ),
  ]);
}

/** "Your work" in a grade or assignment's detail: where the submission
 * stands, what was turned in with the teacher's annotations highlighted and
 * listed, and a button to turn it in (or a note on how this one is handed
 * in). `annotations` arrives the way lazyFetch hands it over: undefined while
 * loading, { error } if the fetch failed. */
export function renderYourWork({ assignment, submission, annotations, onTurnIn, onDownload }) {
  const online = assignment.submission_mode === 'online';
  const marks = Array.isArray(annotations) ? annotations : [];
  const children = [el('div', { class: 'row-section work-heading' }, [el('span', { text: t('work.title') }), online || submission ? statusPill(submission) : null])];

  if (!online) children.push(el('p', { class: 'work-note', text: t(assignment.submission_mode === 'other' ? 'work.otherMode' : 'work.collectedMode') }));
  if (submission?.body) children.push(annotatedBody(submission.body, marks));
  const file = submission?.file_uploads;
  if (file?.storage_path) {
    const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: t('feedback.download', { name: file.file_name || t('detail.download') }) });
    btn.addEventListener('click', () => onDownload(file, btn));
    children.push(el('div', { class: 'panel-actions panel-actions-start' }, [btn]));
  }
  if (annotations?.error) children.push(el('p', { class: 'row-placeholder', text: t('work.annotationsFailed', { msg: annotations.error }) }));
  if (marks.length) children.push(annotationList(marks));

  if (canTurnIn(assignment, submission)) {
    const turnedIn = submission?.status === 'submitted' || submission?.status === 'collected';
    children.push(
      el('div', { class: 'panel-actions panel-actions-start' }, [
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: onTurnIn, text: turnedIn ? t('turnin.update') : t('work.open') }),
      ]),
    );
  } else if (online && submission?.status === 'returned') {
    children.push(el('p', { class: 'work-note', text: t('work.returnedLocked') }));
  }
  return el('div', { class: 'detail-section your-work' }, children);
}
