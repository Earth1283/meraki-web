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
