import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreadIncoming } from '../src/unread.js';

test('unreadIncoming keeps only unread mail to you that is on the server and not already handled', () => {
  const messages = [
    { id: 'm1', read: false, recipient_id: 'me' },
    { id: 'm2', read: true, recipient_id: 'me' },
    { id: 'm3', read: false, recipient_id: 'them' },
    { id: 'temp-1-1', read: false, recipient_id: 'me' },
    { id: 'm4', read: false, recipient_id: 'me' },
  ];
  assert.deepEqual(unreadIncoming(messages, 'me', [new Set(['m4'])]).map((m) => m.id), ['m1']);
});
