import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teacherFeedback } from '../src/feedback.js';

function emptyData(overrides = {}) {
  return { classes: [], assignments: [], grades: [], assignmentSubmissions: [], ...overrides };
}

test('teacherFeedback pairs the grade comment with the submission note', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', title: 'Essay', class_id: 'c1' }],
    grades: [{ id: 'g1', assignment_id: 'a1', points_earned: 9, comment: 'Strong thesis.' }],
    assignmentSubmissions: [{ id: 's1', assignment_id: 'a1', teacher_note: 'Cite your sources.', body: 'My essay' }],
  });
  const expected = { comment: 'Strong thesis.', mark: null, teacherNote: 'Cite your sources.' };
  assert.deepEqual(teacherFeedback({ kind: 'assignment', index: 0 }, data), expected);
  assert.deepEqual(teacherFeedback({ kind: 'grade', index: 0 }, data), expected);
});

test('teacherFeedback reads a mark out of the comment and describes it from the class setup', () => {
  const data = emptyData({
    classes: [{ id: 'c1', weights: { marks: [{ code: 'NS', label: 'Not submitted', behavior: 'zero' }] } }, { id: 'c2', weights: {} }],
    assignments: [{ id: 'a1', class_id: 'c1' }, { id: 'a2', class_id: 'c2' }],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: null, comment: 'MARK:ns' },
      { id: 'g2', assignment_id: 'a2', points_earned: null, comment: 'MARK:L' },
    ],
  });
  assert.deepEqual(teacherFeedback({ kind: 'grade', index: 0 }, data), {
    comment: null,
    mark: { code: 'NS', label: 'Not submitted', behavior: 'zero', value: null },
    teacherNote: null,
  });
  assert.deepEqual(
    teacherFeedback({ kind: 'grade', index: 1 }, data).mark,
    { code: 'L', label: 'Late (half credit)', behavior: 'value', value: 50 },
    'a class with no marks of its own uses the defaults',
  );
});

test('teacherFeedback still shows a mark the class setup no longer defines', () => {
  const data = emptyData({ assignments: [{ id: 'a1', class_id: 'c1' }], grades: [{ id: 'g1', assignment_id: 'a1', comment: 'MARK:ZZ' }] });
  assert.deepEqual(teacherFeedback({ kind: 'assignment', index: 0 }, data).mark, { code: 'ZZ', label: null, behavior: null, value: null });
});

test('teacherFeedback is null when there is nothing to show', () => {
  const data = emptyData({ assignments: [{ id: 'a1' }], grades: [{ id: 'g1', assignment_id: 'a1', points_earned: 9, comment: null }] });
  assert.equal(teacherFeedback({ kind: 'grade', index: 0 }, data), null);
  assert.equal(teacherFeedback({ kind: 'announcement', index: 0 }, data), null);
});
