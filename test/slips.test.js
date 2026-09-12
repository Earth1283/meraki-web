import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strikeNumber } from '../src/slips.js';

test('strikeNumber counts strikes oldest first and skips other notes', () => {
  const data = {
    behaviorNotes: [
      { id: 'n3', kind: 'strike', date: '2026-09-06' },
      { id: 'n2', kind: 'praise', date: '2026-09-05' },
      { id: 'n1', kind: 'strike', date: '2026-09-02' },
    ],
  };
  assert.deepEqual([0, 1, 2].map((i) => strikeNumber(data, i)), [2, null, 1]);
});

test('strikeNumber puts the later row first on a shared date, since rows arrive newest first', () => {
  const data = {
    behaviorNotes: [
      { id: 'n2', kind: 'strike', date: '2026-09-02' },
      { id: 'n1', kind: 'strike', date: '2026-09-02' },
    ],
  };
  assert.deepEqual([0, 1].map((i) => strikeNumber(data, i)), [2, 1]);
});
