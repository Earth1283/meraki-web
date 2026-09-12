import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterGrade, overallGrade } from '../src/grading.js';
import { i18nReady } from '../src/i18n.js';

await i18nReady;

const letters = (scale, cases) => cases.map(([pct]) => [pct, letterGrade(pct, scale).letter]);

test('standard scale follows the school profile table, rounding to whole points first', () => {
  const cases = [
    [104, 'A+'], [100, 'A+'], [97, 'A+'], [96.5, 'A+'],
    [96.4, 'A'], [92, 'A'], [91.5, 'A'],
    [91.4, 'A-'], [87, 'A-'],
    [86, 'B+'], [82, 'B+'],
    [81, 'B'], [77, 'B'],
    [76, 'B-'], [70, 'B-'], [69.5, 'B-'],
    [69, 'C'], [65, 'C'],
    [64, 'D'], [60, 'D'],
    [59.4, 'F'], [0, 'F'],
  ];
  assert.deepEqual(letters('standard', cases), cases);
  assert.deepEqual(
    [97, 90, 84, 72, 66, 61, 12].map((p) => letterGrade(p, 'standard').points),
    [4.0, 3.7, 3.3, 2.7, 2.2, 1.7, 0],
  );
});

test('legacy scale: tens digit is the letter, ones digit 7-9 plus / 3-6 plain / 0-2 minus', () => {
  const cases = [
    [100, 'A+'], [97, 'A+'], [96, 'A'], [93, 'A'], [92, 'A-'], [90, 'A-'], [89.5, 'A-'],
    [89, 'B+'], [84, 'B'], [83, 'B'], [82, 'B-'], [80, 'B-'],
    [79, 'C+'], [74, 'C'], [72, 'C-'], [70, 'C-'],
    [67, 'D+'], [64, 'D'], [63, 'D'], [62, 'D-'], [60, 'D-'],
    [59, 'F'], [3, 'F'],
  ];
  assert.deepEqual(letters('legacy', cases), cases);
  assert.deepEqual(
    [99, 95, 91, 88, 85, 80, 78, 75, 71, 69, 65, 62, 40].map((p) => letterGrade(p, 'legacy').points),
    [4.0, 4.0, 3.7, 3.3, 3.0, 2.7, 2.3, 2.0, 1.7, 1.3, 1.0, 0.7, 0],
  );
});

test('letterGrade has nothing to say without a percentage, and unknown scales read as standard', () => {
  assert.equal(letterGrade(null), null);
  assert.equal(letterGrade(Number.NaN), null);
  assert.deepEqual(letterGrade(88, 'nonsense'), letterGrade(88, 'standard'));
});

function dataWith(classes, assignments, grades) {
  return { classes, assignments, grades };
}
const CLASSES = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
const ASSIGNMENTS = [
  { id: 'a1', class_id: 'c1', points_possible: 100 },
  { id: 'a2', class_id: 'c2', points_possible: 20 },
  { id: 'a3', class_id: 'c3', points_possible: 10 }, // ungraded: c3 stays out of the average
];
const GRADES = [
  { id: 'g1', assignment_id: 'a1', points_earned: 90 },
  { id: 'g2', assignment_id: 'a2', points_earned: 16 },
];

test('overallGrade averages graded classes and grades each class on its own for the GPA', () => {
  const data = dataWith(CLASSES, ASSIGNMENTS, GRADES); // c1 90%, c2 80%

  const standard = overallGrade(data, 'standard');
  assert.equal(standard.pct, 85);
  assert.equal(standard.letter, 'B+');
  assert.equal(standard.classCount, 2);
  assert.ok(Math.abs(standard.gpa - 3.35) < 1e-9, 'A- (3.7) and B (3.0)');

  const legacy = overallGrade(data, 'legacy');
  assert.equal(legacy.letter, 'B');
  assert.ok(Math.abs(legacy.gpa - 3.2) < 1e-9, 'A- (3.7) and B- (2.7)');
});

test('overallGrade falls back to a letter-only grade, or null, when no class can be graded', () => {
  const ungraded = dataWith(CLASSES, ASSIGNMENTS, []);
  assert.equal(overallGrade(ungraded, 'standard'), null);
  const fallback = overallGrade(ungraded, 'legacy', 78);
  assert.equal(fallback.letter, 'C+');
  assert.equal(fallback.gpa, null);
  assert.equal(fallback.scale, 'legacy');
});
