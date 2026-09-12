import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWhatIf, whatIfCandidates, hasWhatIfScores } from '../src/whatif.js';
import { classGradeStats } from '../src/analytics.js';
import { i18nReady } from '../src/i18n.js';

await i18nReady;

function dataWith(assignments, grades) {
  return {
    classes: [], assignments, grades, attendance: [], calendar: [],
    announcements: [], messages: [], portfolio: [], checkins: [],
    hero: null, behaviorNotes: [], detentions: [], reportCards: [],
    assessments: [], discussions: [], fileUploads: [], enrollments: [],
    assignmentSubmissions: [], assessmentSubmissions: [],
  };
}

const ASSIGNMENTS = [
  { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
  { id: 'a2', class_id: 'c1', category: 'Tests', points_possible: 100 },
  { id: 'a3', class_id: 'c1', category: 'Homework', points_possible: 50 },
  { id: 'a4', class_id: 'c2', category: 'Homework', points_possible: 20 },
];
const GRADES = [
  { id: 'g1', assignment_id: 'a1', points_earned: 90, updated_at: '2026-01-01' },
  { id: 'g2', assignment_id: 'a2', points_earned: 70, updated_at: '2026-02-01' },
];

test('applyWhatIf fills in ungraded work and never overrides a real grade', () => {
  const data = dataWith(ASSIGNMENTS, GRADES);
  // a1 is already graded 90/100, so its what-if 0 is ignored; a3 becomes 50/50.
  const projected = applyWhatIf(data, { c1: { scores: { a1: 0, a3: 50 } } });
  assert.equal(classGradeStats(projected, 'c1').currentPct, ((90 + 70 + 50) / 250) * 100);
  assert.equal(data.grades.length, 2, 'the real data is left alone');
});

test('applyWhatIf can add one more assignment to a class', () => {
  const projected = applyWhatIf(dataWith(ASSIGNMENTS, GRADES), { c1: { extra: { earned: 40, possible: 50 } } });
  assert.equal(classGradeStats(projected, 'c1').currentPct, ((90 + 70 + 40) / 250) * 100);
});

test('applyWhatIf ignores blank scores and an extra assignment worth nothing', () => {
  const data = dataWith(ASSIGNMENTS, GRADES);
  const projected = applyWhatIf(data, { c1: { scores: { a3: null }, extra: { earned: 5, possible: 0 } } });
  assert.equal(classGradeStats(projected, 'c1').currentPct, classGradeStats(data, 'c1').currentPct);
});

test('whatIfCandidates lists only the ungraded assignments in the class', () => {
  assert.deepEqual(whatIfCandidates(dataWith(ASSIGNMENTS, GRADES), 'c1').map((a) => a.id), ['a3']);
});

test('hasWhatIfScores is true once a score or a whole extra assignment is entered', () => {
  assert.equal(hasWhatIfScores(undefined), false);
  assert.equal(hasWhatIfScores({ open: true, scores: { a3: null } }), false);
  assert.equal(hasWhatIfScores({ scores: { a3: 0 } }), true);
  assert.equal(hasWhatIfScores({ extra: { earned: 4 } }), false);
  assert.equal(hasWhatIfScores({ extra: { earned: 4, possible: 5 } }), true);
});

test('whatIfCandidates leaves out work already scored with a mark', () => {
  const grades = [...GRADES, { id: 'g3', assignment_id: 'a3', points_earned: null, comment: 'MARK:EX' }];
  assert.deepEqual(whatIfCandidates(dataWith(ASSIGNMENTS, grades), 'c1'), []);
});

test('another assignment in a weighted class goes in the chosen category, or the first one', () => {
  const classes = [{ id: 'c1', weights: { mode: 'weighted', categories: [{ name: 'Homework', weight: 40 }, { name: 'Tests', weight: 60 }] } }];
  const data = { ...dataWith(ASSIGNMENTS, GRADES), classes };
  assert.equal(applyWhatIf(data, { c1: { extra: { earned: 0, possible: 100 } } }).assignments.at(-1).category, 'Homework');
  assert.equal(applyWhatIf(dataWith(ASSIGNMENTS, GRADES), { c1: { extra: { earned: 0, possible: 100 } } }).assignments.at(-1).category, null);
  const chosen = applyWhatIf(data, { c1: { extra: { earned: 0, possible: 100, category: 'Tests' } } });
  // Tests drop to (70 + 0) / 200 = 35%; Homework stays at 90%.
  assert.ok(Math.abs(classGradeStats(chosen, 'c1').currentPct - (90 * 0.4 + 35 * 0.6)) < 1e-9);
});
