import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasStandardsData, standardsMastery, weakestStandardsFirst } from '../src/standards.js';

function dataWith({ classes = [], assignments = [], grades = [], standards = [], assignmentStandards = [] } = {}) {
  return {
    classes, assignments, grades, standards, assignmentStandards,
    attendance: [], calendar: [], announcements: [], messages: [], portfolio: [], checkins: [],
    hero: null, behaviorNotes: [], detentions: [], reportCards: [], assessments: [], discussions: [],
    fileUploads: [], enrollments: [], assignmentSubmissions: [], assessmentSubmissions: [],
  };
}

const STANDARD = { id: 's1', code: 'RL.8.1', description: 'Cite textual evidence…', subject: 'English Language Arts', grade_level: 8 };

function link(id, standardId, assignmentId, classId) {
  return { id, standard_id: standardId, assignment_id: assignmentId, assignments: { title: assignmentId, class_id: classId } };
}

test('hasStandardsData distinguishes an empty standards table from a populated one', () => {
  assert.equal(hasStandardsData(dataWith()), false);
  assert.equal(hasStandardsData(dataWith({ standards: [STANDARD] })), true);
});

test('standardsMastery: no standards at all', () => {
  assert.deepEqual(standardsMastery(dataWith()), []);
});

test('standardsMastery: standards exist but nothing is tagged', () => {
  const [m] = standardsMastery(dataWith({ standards: [STANDARD] }));
  assert.equal(m.status, 'untagged');
  assert.equal(m.taggedCount, 0);
  assert.equal(m.gradedCount, 0);
  assert.equal(m.pct, null);
});

test('standardsMastery: tagged assignments exist but none are graded yet', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [{ id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 }],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.status, 'ungraded');
  assert.equal(m.taggedCount, 1);
  assert.equal(m.gradedCount, 0);
  assert.equal(m.pct, null);
});

test('standardsMastery: averages points earned vs possible across graded, tagged assignments', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [
      { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a2', class_id: 'c1', category: 'Quiz', points_possible: 50 },
      { id: 'a3', class_id: 'c1', category: 'Homework', points_possible: 20 }, // untagged, ignored
    ],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: 80, updated_at: '2026-01-01' },
      { id: 'g2', assignment_id: 'a2', points_earned: 40, updated_at: '2026-01-02' },
    ],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1'), link('l2', 's1', 'a2', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.status, 'graded');
  assert.equal(m.taggedCount, 2);
  assert.equal(m.gradedCount, 2);
  assert.equal(m.earnedPoints, 120);
  assert.equal(m.possiblePoints, 150);
  assert.equal(m.pct, 80);
});

test('standardsMastery: an excused grade counts for nothing, now or later', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [
      { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a2', class_id: 'c1', category: 'Homework', points_possible: 50 },
    ],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: 90, updated_at: '2026-01-01' },
      { id: 'g2', assignment_id: 'a2', points_earned: null, comment: 'MARK:EX', updated_at: '2026-01-02' },
    ],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1'), link('l2', 's1', 'a2', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.taggedCount, 2, 'still tagged, even though excused');
  assert.equal(m.gradedCount, 1, 'excused does not count as graded');
  assert.equal(m.earnedPoints, 90);
  assert.equal(m.possiblePoints, 100);
  assert.equal(m.pct, 90);
});

test('standardsMastery: extra credit adds points without adding to what is possible', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [
      { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a2', class_id: 'c1', category: 'Extra credit', points_possible: 10 },
    ],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: 90, updated_at: '2026-01-01' },
      { id: 'g2', assignment_id: 'a2', points_earned: 5, updated_at: '2026-01-02' },
    ],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1'), link('l2', 's1', 'a2', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.possiblePoints, 100, 'extra credit points never count toward possible');
  assert.equal(m.earnedPoints, 95);
  assert.equal(m.pct, 95);
});

test('standardsMastery: a standard tagged only on extra credit reads as full marks once any is earned', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [{ id: 'a1', class_id: 'c1', category: 'Extra credit', points_possible: 10 }],
    grades: [{ id: 'g1', assignment_id: 'a1', points_earned: 3, updated_at: '2026-01-01' }],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.possiblePoints, 0);
  assert.equal(m.pct, 100);
  assert.equal(m.status, 'graded');
});

test('standardsMastery: a standard tagged across two classes aggregates unscoped and filters when scoped', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }, { id: 'c2', weights: null }],
    assignments: [
      { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a2', class_id: 'c2', category: 'Homework', points_possible: 100 },
    ],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: 90, updated_at: '2026-01-01' },
      { id: 'g2', assignment_id: 'a2', points_earned: 50, updated_at: '2026-01-02' },
    ],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1'), link('l2', 's1', 'a2', 'c2')],
  });
  const [all] = standardsMastery(data);
  assert.equal(all.taggedCount, 2);
  assert.equal(all.pct, 70);

  const [scoped] = standardsMastery(data, { classId: 'c1' });
  assert.equal(scoped.taggedCount, 1);
  assert.equal(scoped.pct, 90);
});

test('standardsMastery: the same assignment tagged twice with a standard counts once', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [{ id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 }],
    grades: [{ id: 'g1', assignment_id: 'a1', points_earned: 90, updated_at: '2026-01-01' }],
    standards: [STANDARD],
    assignmentStandards: [link('l1', 's1', 'a1', 'c1'), link('l2', 's1', 'a1', 'c1')],
  });
  const [m] = standardsMastery(data);
  assert.equal(m.taggedCount, 1);
  assert.equal(m.possiblePoints, 100);
});

test('weakestStandardsFirst sorts ascending by percentage and drops untagged/ungraded standards', () => {
  const data = dataWith({
    classes: [{ id: 'c1', weights: null }],
    assignments: [
      { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a2', class_id: 'c1', category: 'Homework', points_possible: 100 },
      { id: 'a3', class_id: 'c1', category: 'Homework', points_possible: 100 },
    ],
    grades: [
      { id: 'g1', assignment_id: 'a1', points_earned: 95, updated_at: '2026-01-01' },
      { id: 'g2', assignment_id: 'a2', points_earned: 40, updated_at: '2026-01-01' },
    ],
    standards: [
      STANDARD,
      { id: 's2', code: 'RL.8.2', description: 'Determine a theme…', subject: 'English Language Arts', grade_level: 8 },
      { id: 's3', code: 'RL.8.3', description: 'Untagged standard', subject: 'English Language Arts', grade_level: 8 },
      { id: 's4', code: 'RL.8.4', description: 'Tagged, not graded yet', subject: 'English Language Arts', grade_level: 8 },
    ],
    assignmentStandards: [
      link('l1', 's1', 'a1', 'c1'), // 95%
      link('l2', 's2', 'a2', 'c1'), // 40%
      link('l3', 's4', 'a3', 'c1'), // ungraded
    ],
  });
  const mastery = standardsMastery(data);
  const ranked = weakestStandardsFirst(mastery);
  assert.deepEqual(ranked.map((m) => m.code), ['RL.8.2', 'RL.8.1']);
});
