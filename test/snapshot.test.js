import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, usableSnapshot, mergeSnapshotData, snapshotAge, SNAPSHOT_VERSION } from '../src/snapshot.js';

const base = { userId: 'u1', ownStudentId: 's1', ownStudentName: 'A B', now: 1000 };

test('buildSnapshot drops optimistic temp rows but keeps real ones', () => {
  const snap = buildSnapshot({ ...base, data: { messages: [{ id: 'temp-1-1' }, { id: 'm1' }], hero: null } });
  assert.deepEqual(snap.data.messages, [{ id: 'm1' }]);
  assert.equal(snap.data.hero, null);
  assert.equal(snap.savedAt, 1000);
});

test('usableSnapshot rejects other users, other versions and junk', () => {
  const snap = buildSnapshot({ ...base, data: {} });
  assert.equal(usableSnapshot(snap, 'u1'), true);
  assert.equal(usableSnapshot(snap, 'u2'), false);
  assert.equal(usableSnapshot({ ...snap, version: SNAPSHOT_VERSION + 1 }, 'u1'), false);
  assert.equal(usableSnapshot(undefined, 'u1'), false);
  assert.equal(usableSnapshot({ ...snap, savedAt: 'x' }, 'u1'), false);
});

test('mergeSnapshotData fills fields the snapshot lacks and ignores unknown or mistyped ones', () => {
  const empty = { classes: [], hero: null, checkinsUnavailable: false };
  const merged = mergeSnapshotData(empty, { classes: [{ id: 1 }], hero: { x: 1 }, gone: [1], checkinsUnavailable: [] });
  assert.deepEqual(merged, { classes: [{ id: 1 }], hero: { x: 1 }, checkinsUnavailable: false });
});

test('snapshotAge picks the coarsest whole unit', () => {
  const now = 10 * 86_400_000;
  assert.deepEqual(snapshotAge(now - 20_000, now), { value: 0, unit: 'second' });
  assert.deepEqual(snapshotAge(now - 5 * 60_000, now), { value: -5, unit: 'minute' });
  assert.deepEqual(snapshotAge(now - 3 * 3_600_000, now), { value: -3, unit: 'hour' });
  assert.deepEqual(snapshotAge(now - 2 * 86_400_000, now), { value: -2, unit: 'day' });
});
