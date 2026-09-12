import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeSetup, classPercent, countedPoints, isExtraCredit, overallPointsPct, DEFAULT_CATEGORIES } from '../src/gradebook.js';
import { DEFAULT_MARKS } from '../src/marks.js';

const entry = (category, pointsEarned, pointsPossible, markCode = null) => ({ category, pointsEarned, pointsPossible, markCode });
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

test('gradeSetup falls back to the official defaults for anything missing', () => {
  assert.deepEqual(gradeSetup(null), { mode: 'unweighted', categories: DEFAULT_CATEGORIES, marks: DEFAULT_MARKS });
  const own = { mode: 'weighted', categories: [{ name: 'Labs', weight: 100 }, { weight: 5 }], marks: [] };
  assert.deepEqual(gradeSetup(own), { mode: 'weighted', categories: [{ name: 'Labs', weight: 100 }], marks: [] });
  assert.equal(gradeSetup({ mode: 'something else' }).mode, 'unweighted');
});

test('countedPoints applies a mark in place of the score', () => {
  assert.equal(countedPoints(entry('Homework', null, 10, 'M'), DEFAULT_MARKS), 0);
  assert.equal(countedPoints(entry('Homework', null, 10, 'EX'), DEFAULT_MARKS), null);
  assert.equal(countedPoints(entry('Homework', null, 10, 'L'), DEFAULT_MARKS), 5);
  assert.equal(countedPoints(entry('Homework', 7, 10, 'ZZ'), DEFAULT_MARKS), 7, 'an undefined mark leaves the score alone');
  assert.equal(countedPoints(entry('Homework', null, 10), DEFAULT_MARKS), null);
});

test('isExtraCredit ignores case and surrounding space', () => {
  assert.equal(isExtraCredit(' extra CREDIT '), true);
  assert.equal(isExtraCredit('Extra'), false);
  assert.equal(isExtraCredit(null), false);
});

test('unweighted: marks count as the setup says, and extra credit adds points but nothing possible', () => {
  const setup = gradeSetup({});
  const entries = [
    entry('Homework', 8, 10),
    entry('Test', 45, 50),
    entry('Homework', null, 10, 'M'), // 0/10
    entry('Homework', null, 20, 'EX'), // left out
    entry('Homework', null, 10, 'L'), // 5/10
    entry('Extra credit', 3, 5),
    entry('Homework', null, 10), // ungraded
  ];
  assert.ok(near(classPercent(entries, setup), ((8 + 45 + 0 + 5 + 3) / 80) * 100));
});

test('weighted: categories average by weight, with extra credit on top', () => {
  const setup = gradeSetup({ mode: 'weighted', categories: [{ name: 'Homework', weight: 40 }, { name: 'Test', weight: 60 }] });
  const entries = [entry('Homework', 9, 10), entry('Homework', 7, 10), entry('Test', 45, 50)];
  assert.ok(near(classPercent(entries, setup), 80 * 0.4 + 90 * 0.6));
  assert.ok(near(classPercent([...entries, entry('Extra credit', 2, 5)], setup), 86 + (2 / 70) * 100));
});

test('weighted: a category with no graded work drops out and the rest reweigh', () => {
  const setup = gradeSetup({ mode: 'weighted', categories: [{ name: 'Homework', weight: 40 }, { name: 'Test', weight: 60 }] });
  assert.ok(near(classPercent([entry('Homework', 8, 10)], setup), 80));
});

test('weighted: work outside the named categories shares the weight they leave over', () => {
  const setup = gradeSetup({ mode: 'weighted', categories: [{ name: 'Homework', weight: 40 }] });
  assert.ok(near(classPercent([entry('Homework', 8, 10), entry('Lab', 9, 10)], setup), (80 * 40 + 90 * 60) / 100));
  const full = gradeSetup({ mode: 'weighted', categories: [{ name: 'Homework', weight: 100 }] });
  assert.ok(near(classPercent([entry('Homework', 8, 10), entry('Lab', 0, 10)], full), 80), 'no weight left over, so it counts for nothing');
});

test('nothing counted is null, and only earned extra credit is full marks', () => {
  const setup = gradeSetup({});
  assert.equal(classPercent([], setup), null);
  assert.equal(classPercent([entry('Homework', null, 10, 'EX')], setup), null);
  assert.equal(classPercent([entry('Extra credit', 3, 5)], setup), 100);
  assert.equal(classPercent([entry('Extra credit', 0, 5)], setup), null);
});

test('overallPointsPct is the official dashboard figure: points across every scored grade, marks ignored', () => {
  const grades = [
    { points_earned: 45, assignments: { points_possible: 50 } },
    { points_earned: 16, assignments: { points_possible: 20 } },
    { points_earned: null, comment: 'MARK:M', assignments: { points_possible: 10 } },
    { points_earned: 5, assignments: null },
  ];
  assert.ok(near(overallPointsPct(grades), (61 / 70) * 100));
  assert.equal(overallPointsPct([]), null);
  assert.equal(overallPointsPct([{ points_earned: 0, assignments: { points_possible: 0 } }]), null);
});
