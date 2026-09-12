// What a teacher wrote back on graded work: the grade's comment (or the mark
// it was scored with) and the note left on the submission.
import { el } from './dom.js';
import { gradeForAssignment, submissionForAssignment } from './rows.js';
import { markCode, findMark } from './marks.js';
import { gradeSetup } from './gradebook.js';
import { t } from './i18n.js';

const MARK_BEHAVIORS = ['exclude', 'zero', 'value'];

/** The feedback on a grade, or on an assignment's grade and submission:
 * { comment, mark, teacherNote }, or null for any other kind of row or when
 * there's none. A grade scored with a mark has no comment of its own; `mark`
 * is then { code, label, behavior, value }, described by the class's setup
 * where it defines that code. */
export function teacherFeedback(target, data) {
  let grade = null;
  let assignmentId = null;
  if (target.kind === 'grade') {
    grade = data.grades[target.index] ?? null;
    assignmentId = grade?.assignment_id ?? null;
  } else if (target.kind === 'assignment') {
    assignmentId = data.assignments[target.index]?.id ?? null;
    grade = assignmentId ? gradeForAssignment(data, assignmentId) : null;
  } else {
    return null;
  }
  const sub = assignmentId ? submissionForAssignment(data, assignmentId) : null;
  const code = markCode(grade?.comment);
  let mark = null;
  if (code) {
    const classId = data.assignments.find((a) => a.id === assignmentId)?.class_id ?? grade?.assignments?.class_id;
    const definition = findMark(code, gradeSetup(data.classes.find((c) => c.id === classId)?.weights).marks);
    mark = { code, label: definition?.label || null, behavior: definition?.behavior ?? null, value: definition?.value ?? null };
  }
  const feedback = {
    comment: code ? null : grade?.comment || null,
    mark,
    teacherNote: sub?.teacher_note || null,
  };
  return Object.values(feedback).some(Boolean) ? feedback : null;
}

function markLine(mark) {
  let effect = null;
  if (MARK_BEHAVIORS.includes(mark.behavior)) effect = t(`feedback.markBehavior.${mark.behavior}`, { n: mark.value ?? 0 });
  return el('p', { class: 'feedback-mark' }, [
    el('span', { class: 'feedback-mark-code', text: mark.code }),
    el('span', { text: mark.label ?? t('feedback.mark') }),
    effect ? el('span', { class: 'feedback-mark-effect', text: effect }) : null,
  ]);
}

/** The "Teacher feedback" section for what teacherFeedback returned. */
export function renderTeacherFeedback(feedback) {
  const notes = [
    [t('feedback.onGrade'), feedback.comment],
    [t('feedback.onSubmission'), feedback.teacherNote],
  ].filter(([, text]) => text);
  return el('div', { class: 'detail-section' }, [
    el('div', { class: 'row-section' }, t('feedback.title')),
    feedback.mark ? markLine(feedback.mark) : null,
    ...notes.map(([label, text]) =>
      el('figure', { class: 'feedback-note' }, [el('figcaption', { class: 'feedback-label', text: label }), el('blockquote', { class: 'feedback-text', text })]),
    ),
  ]);
}
