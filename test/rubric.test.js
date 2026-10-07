import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rubricBreakdown } from '../src/rubric.js';
import { i18nReady } from '../src/i18n.js';

await i18nReady;

const rubric = {
  title: 'Essay rubric',
  total_points: 12,
  criteria: [
    {
      id: 'c1',
      title: 'Thesis',
      weight: 2,
      levels: [
        { label: 'Strong', points: 4, descriptor: 'Clear and arguable' },
        { label: 'Weak', points: 1, maxPoints: 3, descriptor: 'Vague' },
      ],
    },
    { id: 'c2', title: 'Grammar', levels: [{ label: 'Clean', points: 4 }, { label: 'Messy', points: 0, maxPoints: 2 }] },
  ],
};

test('rubricBreakdown picks the level holding each selection and weights the points', () => {
  const b = rubricBreakdown(rubric, { selections: { c1: 4, c2: 1 }, points_earned: 9, comment: 'Good' });
  assert.deepEqual(b.rows.map((r) => [r.title, r.level?.label, r.earned, r.possible]), [['Thesis', 'Strong', 8, 8], ['Grammar', 'Messy', 1, 4]]);
  assert.deepEqual([b.earned, b.possible, b.comment], [9, 12, 'Good']);
});

test('rubricBreakdown marks a criterion with no selection as unscored', () => {
  const b = rubricBreakdown(rubric, { selections: { c1: 2 }, points_earned: null });
  assert.deepEqual(b.rows.map((r) => [r.scored, r.level?.label ?? null, r.earned]), [[true, 'Weak', 4], [false, null, null]]);
  assert.equal(b.earned, 4);
});

test('rubricBreakdown falls back to the summed criteria when the rubric records no total', () => {
  const b = rubricBreakdown({ ...rubric, total_points: null }, { selections: {} });
  assert.equal(b.possible, 12);
});

test('rubricBreakdown is null without a rubric, a score, or any criteria', () => {
  assert.equal(rubricBreakdown(null, { selections: {} }), null);
  assert.equal(rubricBreakdown(rubric, null), null);
  assert.equal(rubricBreakdown({ criteria: [] }, { selections: {} }), null);
});

test('rubricBreakdown ignores a malformed selections value', () => {
  const b = rubricBreakdown(rubric, { selections: ['x'], points_earned: 0 });
  assert.ok(b.rows.every((r) => !r.scored));
});
