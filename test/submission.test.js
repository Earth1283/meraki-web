import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentForTarget, canTurnIn, safeFileName, submissionStoragePath, turnInProblem, turnInWrite, annotationRuns, MAX_UPLOAD_BYTES,
} from '../src/submission.js';

test('only online assignments can be turned in, and not once they are returned', () => {
  assert.equal(canTurnIn({ submission_mode: 'online' }, null), true);
  assert.equal(canTurnIn({ submission_mode: 'online' }, { status: 'submitted' }), true);
  assert.equal(canTurnIn({ submission_mode: 'online' }, { status: 'returned' }), false);
  assert.equal(canTurnIn({ submission_mode: 'collected' }, null), false);
  assert.equal(canTurnIn({ submission_mode: 'other' }, null), false);
});

test('assignmentForTarget finds the assignment behind a grade or assignment row', () => {
  const data = { assignments: [{ id: 'a1' }, { id: 'a2' }], grades: [{ id: 'g1', assignment_id: 'a2' }, { id: 'g2', assignment_id: 'gone' }] };
  assert.equal(assignmentForTarget({ kind: 'assignment', index: 0 }, data)?.id, 'a1');
  assert.equal(assignmentForTarget({ kind: 'grade', index: 0 }, data)?.id, 'a2');
  assert.equal(assignmentForTarget({ kind: 'grade', index: 1 }, data), null);
  assert.equal(assignmentForTarget({ kind: 'message', index: 0 }, data), null);
});

test('a turned-in file gets a storage-safe name under its assignment and student', () => {
  assert.equal(safeFileName('My Essay (final).pdf'), 'My-Essay-final-.pdf');
  assert.equal(safeFileName(`${'x'.repeat(100)}.txt`).length, 80);
  assert.equal(submissionStoragePath('a1', 's1', 'lab report.docx', 1700000000000), 'assignments/a1/s1/1700000000000-lab-report.docx');
});

test('turnInProblem makes the checks the official site makes before saving', () => {
  const base = { studentId: 's1', final: true, body: '', file: null, existing: null };
  assert.equal(turnInProblem({ ...base, studentId: null }), 'turnin.noStudentRecord');
  assert.equal(turnInProblem(base), 'turnin.empty');
  assert.equal(turnInProblem({ ...base, body: '   ' }), 'turnin.empty');
  assert.equal(turnInProblem({ ...base, final: false }), null, 'an empty draft can still be saved');
  assert.equal(turnInProblem({ ...base, body: 'My answer' }), null);
  assert.equal(turnInProblem({ ...base, existing: { file_upload_id: 'f1' } }), null, 'a file already attached counts');
  assert.equal(turnInProblem({ ...base, file: { size: MAX_UPLOAD_BYTES } }), null);
  assert.equal(turnInProblem({ ...base, file: { size: MAX_UPLOAD_BYTES + 1 } }), 'turnin.tooBig');
});

test('turnInWrite updates an existing submission, and a returned one stays returned', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  const args = { assignmentId: 'a1', studentId: 's1', body: ' Answer ', fileUploadId: 'f1', final: true, now };
  assert.deepEqual(turnInWrite({ ...args, existing: { id: 'sub1', status: 'draft' } }), {
    op: 'update',
    id: 'sub1',
    data: { body: 'Answer', file_upload_id: 'f1', status: 'submitted', submitted_at: '2026-09-12T10:00:00.000Z' },
  });
  assert.equal(turnInWrite({ ...args, existing: { id: 'sub1', status: 'returned' } }).data.status, 'returned');
  assert.equal(turnInWrite({ ...args, final: false, existing: { id: 'sub1', status: 'submitted' } }).data.status, 'draft');
});

test('turnInWrite creates the submission when there is none yet', () => {
  assert.deepEqual(turnInWrite({ assignmentId: 'a1', studentId: 's1', existing: null, body: '   ', fileUploadId: null, final: false }), {
    op: 'insert',
    data: { assignment_id: 'a1', student_id: 's1', body: null, file_upload_id: null, status: 'draft' },
  });
});

const plain = (runs) => runs.map((r) => [r.text, r.marks, r.ends]);

test('annotationRuns highlights each annotation where its offsets land', () => {
  const runs = annotationRuns('The cat sat on the mat.', [
    { excerpt: 'cat', start_offset: 4, end_offset: 7 },
    { excerpt: 'mat', start_offset: 19, end_offset: 22 },
  ]);
  assert.deepEqual(plain(runs), [['The ', [], []], ['cat', [1], [1]], [' sat on the ', [], []], ['mat', [2], [2]], ['.', [], []]]);
});

test('annotationRuns finds an excerpt whose offsets no longer fit, and skips one it cannot find', () => {
  const runs = annotationRuns('Edited: the cat sat.', [
    { excerpt: 'cat', start_offset: 4, end_offset: 7 },
    { excerpt: 'dog', start_offset: 0, end_offset: 3 },
    { excerpt: '', start_offset: null, end_offset: null },
  ]);
  assert.deepEqual(plain(runs), [['Edited: the ', [], []], ['cat', [1], [1]], [' sat.', [], []]]);
});

test('annotationRuns splits overlapping annotations into runs marked by both', () => {
  const runs = annotationRuns('abcdef', [
    { excerpt: 'abcd', start_offset: 0, end_offset: 4 },
    { excerpt: 'cdef', start_offset: 2, end_offset: 6 },
  ]);
  assert.deepEqual(plain(runs), [['ab', [1], []], ['cd', [1, 2], [1]], ['ef', [2], [2]]]);
});

test('annotationRuns keeps the whole text in one run when nothing is highlighted', () => {
  assert.deepEqual(plain(annotationRuns('Just text', [])), [['Just text', [], []]]);
});
