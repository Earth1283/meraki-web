import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreText, searchEntries, emptyQueryResults, clampSelection, loadRecentIds, recordRecentId } from '../src/palette.js';

test('scoreText matches a whole-query acronym across word boundaries ("gtc" -> "Go to Classes")', () => {
  const score = scoreText('gtc', 'Go to Classes');
  assert.notEqual(score, null);
  assert.ok(score > 50, `expected a strong acronym score, got ${score}`);
});

test('scoreText finds a subsequence even when it is not an acronym or a prefix ("anl" -> "Analytics")', () => {
  assert.notEqual(scoreText('anl', 'Analytics'), null);
});

test('scoreText ranks a literal prefix match above the same letters landing mid-word', () => {
  const prefix = scoreText('cla', 'Classes');
  const midWord = scoreText('cla', 'Declassified');
  assert.notEqual(prefix, null);
  assert.notEqual(midWord, null);
  assert.ok(prefix > midWord, `prefix match (${prefix}) should outscore a mid-word match (${midWord})`);
});

test('scoreText rewards a match landing on a word boundary over the same letter mid-word', () => {
  const boundary = scoreText('c', 'Go to Classes');
  const midWord = scoreText('c', 'success');
  assert.notEqual(boundary, null);
  assert.notEqual(midWord, null);
  assert.ok(boundary > midWord, `boundary hit (${boundary}) should outscore a mid-word hit (${midWord})`);
});

test('scoreText penalises gaps between scattered matches', () => {
  const tight = scoreText('ab', 'abcdef');
  const scattered = scoreText('ab', 'axxxxb');
  assert.notEqual(tight, null);
  assert.notEqual(scattered, null);
  assert.ok(tight > scattered, `a tight match (${tight}) should outscore a scattered one (${scattered})`);
});

test('scoreText returns null when the query is not even a subsequence of the text', () => {
  assert.equal(scoreText('xyz', 'Refresh data'), null);
  assert.equal(scoreText('anl', ''), null);
});

test('scoreText treats a blank query as matching everything with a neutral score', () => {
  assert.equal(scoreText('', 'anything'), 0);
  assert.equal(scoreText('   ', 'anything'), 0);
});

test('searchEntries ranks matches best-first and caps the result set', () => {
  const entries = [
    { id: 'exact', text: 'Go' },
    ...Array.from({ length: 11 }, (_, i) => ({ id: `goto-${i}`, text: `Go to Class ${i}` })),
  ];
  const results = searchEntries('go', entries, { limit: 8 });
  assert.equal(results.length, 8, 'result set should be capped at the given limit');
  assert.equal(results[0].id, 'exact', 'the exact, shortest match should rank first');
});

test('searchEntries excludes non-matches entirely rather than showing everything', () => {
  const entries = [{ id: 'a', text: 'Refresh data' }, { id: 'b', text: 'Log out' }];
  const results = searchEntries('xyz', entries);
  assert.deepEqual(results, []);
});

test('searchEntries breaks equal-score ties by recency, most recent first', () => {
  const entries = [{ id: 'x1', text: 'Refresh data' }, { id: 'x2', text: 'Refresh data' }];
  const results = searchEntries('refresh', entries, { recentIds: ['x2'] });
  assert.deepEqual(results.map((r) => r.id), ['x2', 'x1']);
});

test('emptyQueryResults shows recents first (most recent first), then fills in with the remaining defaults', () => {
  const entries = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }];
  const results = emptyQueryResults(entries, ['c', 'a'], 3);
  assert.deepEqual(results.map((r) => r.id), ['c', 'a', 'b']);
});

test('emptyQueryResults ignores a recent id that no longer matches a known entry', () => {
  const entries = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
  const results = emptyQueryResults(entries, ['ghost', 'b'], 5);
  assert.deepEqual(results.map((r) => r.id), ['b', 'a']);
});

test('clampSelection keeps the roving index inside a shrinking or growing result list', () => {
  assert.equal(clampSelection(5, 3), 2);
  assert.equal(clampSelection(-1, 3), 0);
  assert.equal(clampSelection(1, 1), 0);
  assert.equal(clampSelection(2, 0), -1);
  assert.equal(clampSelection(0, 0), -1);
});

test('loadRecentIds falls back to an empty list when storage throws or is unavailable', () => {
  assert.deepEqual(loadRecentIds(), []);
});

test('recordRecentId keeps the most-recent id first, de-duplicates, and caps the list', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  try {
    recordRecentId('a');
    recordRecentId('b');
    recordRecentId('a');
    assert.deepEqual(loadRecentIds(), ['a', 'b']);
    for (let i = 0; i < 10; i += 1) recordRecentId(`extra-${i}`);
    assert.ok(loadRecentIds().length <= 8, 'recents list should never grow unbounded');
  } finally {
    delete globalThis.localStorage;
  }
});
