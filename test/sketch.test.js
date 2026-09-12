import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom, sketchLine, sketchCircle, sketchBox, sketchGrid, sketchTick, sketchStar, sketchSpiral, sketchFace, tallyGroups, sketchTallyGroup, sketchArrow, sketchPlane } from '../src/sketch.js';

const numbersIn = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);

test('seededRandom is deterministic per seed and stays in [0, 1)', () => {
  const seq = (seed) => Array.from({ length: 50 }, seededRandom(seed));
  assert.deepEqual(seq('day:2026-04-10'), seq('day:2026-04-10'));
  assert.notDeepEqual(seq('day:2026-04-10'), seq('day:2026-04-11'));
  assert.ok(seq(42).every((n) => n >= 0 && n < 1));
});

test('sketchLine redraws the identical stroke for the same seed', () => {
  const draw = (seed) => sketchLine(0, 0, 100, 0, seededRandom(seed), { bow: 3, overshoot: 4, jitter: 1 });
  assert.equal(draw('x'), draw('x'));
  assert.notEqual(draw('x'), draw('y'));
});

test('sketchLine without overshoot or jitter starts and ends exactly on its endpoints', () => {
  const d = sketchLine(10, 20, 90, 60, seededRandom(1), { bow: 5 });
  assert.match(d, /^M 10 20 C /);
  assert.deepEqual(numbersIn(d).slice(-2), [90, 60]);
});

test('sketchLine overshoot runs past the endpoints along the line, not off it', () => {
  const nums = numbersIn(sketchLine(0, 50, 100, 50, seededRandom(2), { bow: 0, overshoot: 6 }));
  const [sx, sy] = nums.slice(0, 2);
  const [ex, ey] = nums.slice(-2);
  assert.ok(sx < 0 && sx >= -6, `start x ${sx}`);
  assert.ok(ex > 100 && ex <= 106, `end x ${ex}`);
  assert.equal(sy, 50);
  assert.equal(ey, 50);
});

test('sketchCircle loops past a full turn and stays near its ellipse', () => {
  const d = sketchCircle(20, 15, 16, 11, seededRandom('today'));
  const nums = numbersIn(d);
  assert.ok(nums.every(Number.isFinite));
  assert.ok(nums.filter((_, i) => i % 2 === 0).every((x) => Math.abs(x - 20) <= 20));
  assert.ok(nums.filter((_, i) => i % 2 === 1).every((y) => Math.abs(y - 15) <= 20));
  assert.ok(d.match(/C/g).length > 20, 'a full turn plus the overlapping tail');
});

test('sketchBox draws four separate sides; sketchGrid rules every column and row edge', () => {
  assert.equal(sketchBox(0, 0, 100, 100, seededRandom(3)).length, 4);
  assert.equal(sketchGrid(7, 6, seededRandom(4)).length, 8 + 7);
});

test('sketchTick is one two-stroke path with finite coordinates', () => {
  const d = sketchTick(0, 0, 20, seededRandom(5));
  assert.match(d, /^M [^MCQ]+ Q [^MC]+ Q [^MC]+$/);
  assert.ok(numbersIn(d).every(Number.isFinite));
});

test('sketchStar is one five-point stroke; sketchSpiral winds out from its center', () => {
  const star = sketchStar(20, 20, 12, seededRandom(6));
  assert.equal(star.match(/L/g).length, 5);
  assert.ok(numbersIn(star).every(Number.isFinite));
  const [sx, sy] = numbersIn(sketchSpiral(40, 30, 10, seededRandom(7)));
  assert.ok(Math.hypot(sx - 40, sy - 30) < 0.5, 'starts at the center');
});

test('sketchFace frowns for low moods and smiles for high ones', () => {
  const mouth = (mood) => numbersIn(sketchFace(mood, seededRandom(`face:${mood}`))[3]);
  for (let mood = 1; mood <= 5; mood++) assert.equal(sketchFace(mood, seededRandom(mood)).length, 4);
  const [, y1, , c1] = mouth(1);
  const [, y4, , c4] = mouth(4);
  assert.ok(c1 < y1, 'mood 1 bends up in the middle: a frown');
  assert.ok(c4 > y4, 'mood 4 bends down in the middle: a smile');
});

test('tallyGroups bundles counts in fives and sketchTallyGroup slashes the fifth', () => {
  assert.deepEqual(tallyGroups(0), []);
  assert.deepEqual(tallyGroups(4), [4]);
  assert.deepEqual(tallyGroups(5), [5]);
  assert.deepEqual(tallyGroups(12), [5, 5, 2]);
  assert.equal(sketchTallyGroup(3, seededRandom(8)).length, 3);
  assert.equal(sketchTallyGroup(5, seededRandom(9)).length, 5);
});

test('sketchArrow heads pass through the tip; sketchPlane is an outline plus its fold', () => {
  const [shaft, head] = sketchArrow(22, 4, 2, 10, seededRandom(10));
  assert.deepEqual(numbersIn(shaft).slice(-2), [2, 10]);
  assert.deepEqual(numbersIn(head).slice(2, 4), [2, 10]);
  const plane = sketchPlane(seededRandom(11));
  assert.equal(plane.length, 2);
  assert.ok(plane.flatMap(numbersIn).every(Number.isFinite));
});

