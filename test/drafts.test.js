import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDraft, writeDraft, removeDraft, draftSyncPreferences, setDraftSyncPreferences, createDraftSync } from '../src/drafts.js';
import { saveCloudDraft } from '../src/draftcloud.js';
import { i18nReady } from '../src/i18n.js';
await i18nReady;

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}

function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, delay) { tasks.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(key) { tasks.delete(key); },
    async advance(ms) {
      now += ms;
      for (const [key, task] of [...tasks]) if (task.at <= now) { tasks.delete(key); task.fn(); }
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
    get pending() { return tasks.size; },
  };
}

test('assignment text and quiz timer survive recovery and stay scoped to account and kind', () => {
  const s = storage();
  writeDraft('u1', 'assignment', 'same', { body: 'unfinished', fileName: 'essay.pdf' }, s);
  writeDraft('u1', 'quiz', 'same', { answers: { q1: 2 }, startedAt: 100, index: 1 }, s);
  assert.equal(readDraft('u1', 'assignment', 'same', s).body, 'unfinished');
  assert.equal(readDraft('u1', 'quiz', 'same', s).startedAt, 100);
  assert.equal(readDraft('u2', 'assignment', 'same', s), null);
  removeDraft('u1', 'assignment', 'same', s);
  assert.equal(readDraft('u1', 'assignment', 'same', s), null);
  assert.ok(readDraft('u1', 'quiz', 'same', s));
});

test('malformed records and storage quota errors are recoverable failures', () => {
  const s = storage();
  writeDraft('u1', 'quiz', 'a1', { answers: {} }, s);
  for (const key of s.data.keys()) s.data.set(key, '{bad json');
  assert.equal(readDraft('u1', 'quiz', 'a1', s), null);
  assert.equal(writeDraft('u1', 'quiz', 'a1', {}, { setItem() { throw Error('quota'); } }), false);
});

test('cloud is off by default and preferences do not carry across accounts', () => {
  const s = storage();
  assert.equal(draftSyncPreferences('u1', s).mode, 'local');
  setDraftSyncPreferences('u1', { mode: 'interval', intervalMs: 300000 }, s);
  assert.deepEqual(draftSyncPreferences('u1', s), { mode: 'interval', delayMs: 15000, intervalMs: 300000 });
  assert.equal(draftSyncPreferences('u2', s).mode, 'local');
  setDraftSyncPreferences('u1', { mode: 'bad', intervalMs: -1 }, s);
  assert.equal(draftSyncPreferences('u1', s).mode, 'local');
});

test('local-only never writes to the cloud, including a manual sync request', async () => {
  const timers = clock(); let writes = 0;
  const sync = createDraftSync({ timers, snapshot: () => ({}), write: () => writes++ });
  sync.edit(); await timers.advance(999999);
  assert.equal(await sync.sync(), false);
  assert.equal(writes, 0);
});

test('idle sync waits for the selected pause after the most recent edit', async () => {
  const timers = clock(); const sent = []; let text = 'first';
  const sync = createDraftSync({ timers, preferences: { mode: 'idle', delayMs: 5000 }, snapshot: () => text, write: value => sent.push(value) });
  sync.edit(); await timers.advance(4000); text = 'second'; sync.edit();
  await timers.advance(4000); assert.deepEqual(sent, []);
  await timers.advance(1000); assert.deepEqual(sent, ['second']);
  assert.equal(sync.status.dirty, false);
});

test('interval sync is not postponed by continuous typing and does not resend clean drafts', async () => {
  const timers = clock(); let writes = 0;
  const sync = createDraftSync({ timers, preferences: { mode: 'interval', intervalMs: 30000 }, snapshot: () => 'text', write: () => writes++ });
  sync.edit(); await timers.advance(15000); sync.edit();
  await timers.advance(15000); assert.equal(writes, 1);
  await timers.advance(60000); assert.equal(writes, 1);
});

test('disabling cloud cancels pending writes; inactive accounts cannot sync', async () => {
  const timers = clock(); let writes = 0, active = true;
  const sync = createDraftSync({ timers, active: () => active, preferences: { mode: 'idle', delayMs: 5000 }, snapshot: () => 'text', write: () => writes++ });
  sync.edit(); sync.configure({ mode: 'local' }); await timers.advance(5000);
  assert.equal(writes, 0);
  sync.configure({ mode: 'manual' }); active = false;
  await sync.sync(); assert.equal(writes, 0);
});

test('writes serialize and an edit during sync stays dirty for the next write', async () => {
  let finish; const sent = []; let value = 'old';
  const sync = createDraftSync({ preferences: { mode: 'manual' }, snapshot: () => value, write: v => { sent.push(v); return new Promise(resolve => { finish = resolve; }); } });
  sync.edit(); const first = sync.sync(); await Promise.resolve();
  value = 'new'; sync.edit(); assert.equal(sync.sync(), first);
  finish(); await first; assert.equal(sync.status.dirty, true);
  const second = sync.sync(); await Promise.resolve(); finish(); await second;
  assert.deepEqual(sent, ['old', 'new']); assert.equal(sync.status.dirty, false);
});

test('failed sync keeps the draft dirty and can be retried', async () => {
  let fail = true;
  const sync = createDraftSync({ preferences: { mode: 'manual' }, snapshot: () => 'draft', write: () => { if (fail) throw Error('offline'); } });
  sync.edit(); assert.equal(await sync.sync(), false); assert.equal(sync.status.error.message, 'offline');
  assert.equal(sync.status.dirty, true); fail = false; assert.equal(await sync.sync(), true);
  assert.equal(sync.status.error, null);
});

function cloudClient(status = 'draft') {
  const calls = [];
  const client = {
    getSession: () => ({ user_id: 'u1' }),
    getTable: async () => status ? [{ id: 'sub1', status, file_upload_id: 'file1' }] : [],
    updateDraftSubmission: async (...args) => calls.push(['update', ...args]),
    insertRow: async (...args) => { calls.push(['insert', ...args]); return 'new1'; },
    uploadFile: async (...args) => calls.push(['upload', ...args]),
  };
  return { client, calls };
}
const cloudArgs = { assignment: { id: 'a1', class_id: 'c1', title: 'Essay', submission_mode: 'online' }, studentId: 's1', userId: 'u1', body: ' unfinished ', file: null };

test('cloud sync updates an existing draft without turning it in or changing its turn-in time', async () => {
  const { client, calls } = cloudClient();
  await saveCloudDraft(cloudArgs, client);
  assert.deepEqual(calls, [['update', 'sub1', 's1', { body: ' unfinished ', file_upload_id: 'file1' }]]);
});

test('cloud sync creates a draft when none exists', async () => {
  const { client, calls } = cloudClient(null);
  await saveCloudDraft(cloudArgs, client);
  assert.equal(calls[0][2].status, 'draft');
  assert.equal('submitted_at' in calls[0][2], false);
});

test('cloud sync refuses submitted, collected and returned work before any upload', async () => {
  for (const status of ['submitted', 'collected', 'returned']) {
    const { client, calls } = cloudClient(status);
    await assert.rejects(saveCloudDraft({ ...cloudArgs, file: { name: 'essay.pdf', size: 100 } }, client), /turned in or locked/);
    assert.deepEqual(calls, []);
  }
});

test('switching accounts during a cloud lookup cannot send a draft under the next account', async () => {
  const { client, calls } = cloudClient();
  client.getTable = async () => { client.getSession = () => ({ user_id: 'u2' }); return []; };
  await assert.rejects(saveCloudDraft(cloudArgs, client), /account changed/);
  assert.deepEqual(calls, []);
});

test('cloud sync uploads attachments once before linking them to the draft', async () => {
  const { client, calls } = cloudClient();
  await saveCloudDraft({ ...cloudArgs, file: { name: 'essay.pdf', size: 100, type: 'application/pdf' } }, client);
  assert.deepEqual(calls.map(c => c[0]), ['upload', 'insert', 'update']);
  assert.equal(calls[1][1], 'file_uploads');
  assert.equal(calls[2][3].file_upload_id, 'new1');
});
