import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classGradeStats, targetProjection } from '../src/analytics.js';
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

test('classGradeStats splits graded vs remaining points and groups categories', () => {
  const stats = classGradeStats(dataWith(ASSIGNMENTS, GRADES), 'c1');
  assert.equal(stats.earnedPoints, 160);
  assert.equal(stats.gradedPossible, 200);
  assert.equal(stats.remainingPossible, 50);
  assert.equal(stats.currentPct, 80);
  assert.deepEqual(
    stats.categoryBreakdown.map((c) => [c.category, c.pct]),
    [['Homework', 90], ['Tests', 70]],
  );
  assert.deepEqual(
    stats.trend.map((p) => Math.round(p.pct)),
    [90, 80],
  );
});

test('classGradeStats reports a null currentPct when nothing is graded yet', () => {
  const stats = classGradeStats(dataWith(ASSIGNMENTS, []), 'c1');
  assert.equal(stats.currentPct, null);
  assert.equal(stats.gradedPossible, 0);
  assert.equal(stats.remainingPossible, 250);
});

test('targetProjection: onTrack when a reachable average is still needed', () => {
  const stats = classGradeStats(dataWith(ASSIGNMENTS, GRADES), 'c1');
  const projection = targetProjection(stats, 75);
  assert.equal(projection.status, 'onTrack');
  assert.equal(Math.round(projection.requiredAvgPct), 55);
  assert.equal(projection.diffFromCurrent, -5);
});

test('targetProjection: guaranteed when the target is already locked in', () => {
  const stats = classGradeStats(dataWith(ASSIGNMENTS, GRADES), 'c1');
  const projection = targetProjection(stats, 50);
  assert.equal(projection.status, 'guaranteed');
});

test('targetProjection: unreachable when even a perfect score falls short', () => {
  const stats = classGradeStats(dataWith(ASSIGNMENTS, GRADES), 'c1');
  const projection = targetProjection(stats, 85);
  assert.equal(projection.status, 'unreachable');
  assert.equal(projection.maxAchievablePct, 84);
});

test('targetProjection: final when there is no remaining graded work', () => {
  const finished = [
    { id: 'a1', class_id: 'c1', category: 'Homework', points_possible: 100 },
    { id: 'a2', class_id: 'c1', category: 'Tests', points_possible: 100 },
  ];
  const stats = classGradeStats(dataWith(finished, GRADES), 'c1');
  const projection = targetProjection(stats, 90);
  assert.equal(projection.status, 'final');
  assert.equal(projection.maxAchievablePct, 80);
  assert.equal(projection.diffFromCurrent, 10);
});

const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

test('classGradeStats counts marks the way the official site does', () => {
  const withMark = (comment) => [...GRADES, { id: 'g3', assignment_id: 'a3', points_earned: null, comment, updated_at: '2026-03-01' }];
  const missing = classGradeStats(dataWith(ASSIGNMENTS, withMark('MARK:M')), 'c1');
  assert.ok(near(missing.currentPct, (160 / 250) * 100), 'missing counts as zero');
  assert.equal(missing.remainingPossible, 0);
  const excused = classGradeStats(dataWith(ASSIGNMENTS, withMark('MARK:EX')), 'c1');
  assert.equal(excused.currentPct, 80, 'excused drops out');
  assert.equal(excused.remainingPossible, 0);
  assert.equal(targetProjection(excused, 90).status, 'final');
  const late = classGradeStats(dataWith(ASSIGNMENTS, withMark('MARK:L')), 'c1');
  assert.ok(near(late.currentPct, (185 / 250) * 100), 'late is half credit');
});

test('classGradeStats adds extra credit without adding to what is possible', () => {
  const assignments = [
    ...ASSIGNMENTS,
    { id: 'a5', class_id: 'c1', category: 'Extra credit', points_possible: 10 },
    { id: 'a6', class_id: 'c1', category: 'Extra credit', points_possible: 10 },
  ];
  const stats = classGradeStats(dataWith(assignments, [...GRADES, { id: 'g5', assignment_id: 'a5', points_earned: 10, updated_at: '2026-03-01' }]), 'c1');
  assert.ok(near(stats.currentPct, 85));
  assert.equal(stats.gradedPossible, 200);
  assert.equal(stats.remainingPossible, 50, 'ungraded extra credit is not remaining work');
});

test('classGradeStats and targetProjection follow a weighted class setup', () => {
  const classes = [{ id: 'c1', weights: { mode: 'weighted', categories: [{ name: 'Homework', weight: 40 }, { name: 'Tests', weight: 60 }] } }];
  const data = { ...dataWith(ASSIGNMENTS, GRADES), classes };
  const stats = classGradeStats(data, 'c1');
  assert.ok(near(stats.currentPct, 90 * 0.4 + 70 * 0.6));
  const projection = targetProjection(stats, 75);
  assert.equal(projection.status, 'onTrack');
  assert.ok(near(projection.requiredAvgPct, 67.5), String(projection.requiredAvgPct));
  // Scoring exactly that on the remaining homework lands on the target.
  const scored = classGradeStats({ ...data, grades: [...GRADES, { id: 'g3', assignment_id: 'a3', points_earned: 50 * 0.675, updated_at: '2026-03-01' }] }, 'c1');
  assert.ok(near(scored.currentPct, 75), String(scored.currentPct));
});
