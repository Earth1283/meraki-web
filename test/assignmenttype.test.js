import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryTone, TYPE_TONES } from '../src/assignmenttype.js';

test('categoryTone gives the usual category names fixed tones, ignoring case and padding', () => {
  assert.equal(categoryTone('Quiz'), categoryTone(' quiz '));
  assert.equal(categoryTone('Major'), categoryTone('Test'));
  assert.notEqual(categoryTone('Homework'), categoryTone('Quiz'));
});

test('categoryTone is stable and in range for any other name, and null for none', () => {
  const tone = categoryTone('Lab report');
  assert.equal(tone, categoryTone('Lab report'));
  assert.ok(Number.isInteger(tone) && tone >= 0 && tone < TYPE_TONES);
  assert.equal(categoryTone(null), null);
  assert.equal(categoryTone('  '), null);
});
