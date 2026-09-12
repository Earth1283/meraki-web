import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoreRows } from '../src/paging.js';

test('hasMoreRows trusts the server total when there is one', () => {
  assert.equal(hasMoreRows(69, { total: 245 }), true);
  assert.equal(hasMoreRows(245, { total: 245 }), false);
});

test('hasMoreRows falls back to whether the last page came back full', () => {
  assert.equal(hasMoreRows(69, { total: null, full: true }), true);
  assert.equal(hasMoreRows(12, { total: null, full: false }), false);
});

test('hasMoreRows stops once a page added nothing, or before anything loaded', () => {
  assert.equal(hasMoreRows(69, { total: 245, exhausted: true }), false);
  assert.equal(hasMoreRows(0, undefined), false);
});
