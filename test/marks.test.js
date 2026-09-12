import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markCode, findMark, DEFAULT_MARKS } from '../src/marks.js';

test('markCode reads the code out of a MARK: comment, uppercased', () => {
  assert.equal(markCode('MARK:M'), 'M');
  assert.equal(markCode(' MARK:ex '), 'EX');
  assert.equal(markCode('MARK:A+'), 'A+');
  assert.equal(markCode('Great work, MARK:M'), null);
  assert.equal(markCode('Nice job'), null);
  assert.equal(markCode(null), null);
});

test('findMark matches codes without regard to case', () => {
  assert.equal(findMark('ex', DEFAULT_MARKS)?.label, 'Exempt / excused');
  assert.equal(findMark('ZZ', DEFAULT_MARKS), null);
  assert.equal(findMark(null, DEFAULT_MARKS), null);
});
