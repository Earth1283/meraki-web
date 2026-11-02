import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, isTransient, TransientHttpError } from '../src/retry.js';

const noSleep = async () => {};

test('withRetry retries a dropped connection and returns the later success', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('Failed to fetch');
    return 'ok';
  }, { sleep: noSleep });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry gives up after its delays run out and throws the last error', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => {
    calls += 1;
    throw new TransientHttpError('GET x failed (503): down', 503);
  }, { delays: [1, 1], sleep: noSleep }), /503/);
  assert.equal(calls, 3);
});

test('withRetry does not retry a real server answer', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => {
    calls += 1;
    throw new Error('GET x failed (403): nope');
  }, { sleep: noSleep }), /403/);
  assert.equal(calls, 1);
});

test('timeouts and aborts count as transient, a 429 does not', () => {
  assert.equal(isTransient(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
  assert.equal(isTransient(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(isTransient(new Error('GET x failed (429): slow down')), false);
});
