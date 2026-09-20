import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousSignIn, newCount, activityKindMeta, activityRows, activityFeedView, ACTIVITY_FEED_LIMIT } from '../src/activity.js';
import { t, i18nReady } from '../src/i18n.js';

await i18nReady;

// Local Date objects throughout (never a hardcoded UTC offset): activityRows
// buckets by local calendar day the same way rows.js/calendar.js do, so a
// fixture built from a fixed UTC instant would land on a different day
// depending on the machine's timezone.
const NOW = new Date(2026, 8, 20, 12, 0, 0);
const at = (...ymdhms) => new Date(...ymdhms).toISOString();

function item(overrides = {}) {
  return {
    id: 'grade-1',
    kind: 'grade',
    classId: 'c1',
    className: 'G9 English',
    title: 'Harrison Bergeron',
    subtitle: null,
    body: 'Auto-graded assessment',
    at: at(2026, 8, 20, 10, 0, 0),
    studentName: null,
    ...overrides,
  };
}

test('previousSignIn needs at least two recorded sign-ins', () => {
  assert.equal(previousSignIn([]), null);
  assert.equal(previousSignIn([{ id: '1', signed_in_at: '2026-09-20T00:00:00Z' }]), null);
  assert.equal(previousSignIn(null), null);
  assert.equal(previousSignIn(undefined), null);
});

test('previousSignIn returns the second-newest sign-in, not the current one', () => {
  const events = [
    { id: '3', signed_in_at: '2026-09-20T09:00:00Z' },
    { id: '2', signed_in_at: '2026-09-18T09:00:00Z' },
    { id: '1', signed_in_at: '2026-09-10T09:00:00Z' },
  ];
  assert.equal(previousSignIn(events), '2026-09-18T09:00:00Z');
});

test('newCount is 0 with no watermark', () => {
  assert.equal(newCount([item()], null), 0);
  assert.equal(newCount([item()], undefined), 0);
});

test('newCount only counts items strictly after the watermark', () => {
  const since = at(2026, 8, 19, 0, 0, 0);
  const items = [
    item({ id: 'a', at: at(2026, 8, 20, 0, 0, 0) }),
    item({ id: 'b', at: since }), // exactly at the watermark: not new
    item({ id: 'c', at: at(2026, 8, 18, 0, 0, 0) }),
  ];
  assert.equal(newCount(items, since), 1);
});

// The English strings themselves are added to src/locales/*.json separately
// (see the integration note); this only pins down the key namespace and
// shape, not that a translation has landed yet.
test('activityKindMeta maps every known kind to an icon and an activity.kind.* label key', () => {
  for (const kind of ['grade', 'announcement', 'assignment', 'submission', 'message']) {
    const meta = activityKindMeta(kind);
    assert.ok(meta.icon);
    assert.match(meta.labelKey, /^activity\.kind\./);
  }
});

test('activityKindMeta degrades gracefully for an unrecognised kind', () => {
  const meta = activityKindMeta('some_future_kind');
  assert.ok(meta.icon);
  assert.equal(meta.labelKey, null);
});

test('activityRows is empty for an empty feed', () => {
  assert.deepEqual(activityRows([], { now: NOW }), []);
  assert.deepEqual(activityRows(null, { now: NOW }), []);
});

test('activityRows groups items under Today / Yesterday / weekday+date headers, newest first', () => {
  const rows = activityRows([
    item({ id: 'a', at: at(2026, 8, 20, 8, 0, 0) }), // today
    item({ id: 'b', at: at(2026, 8, 20, 20, 0, 0) }), // also today, later
    item({ id: 'c', at: at(2026, 8, 19, 8, 0, 0) }), // yesterday
    item({ id: 'd', at: at(2026, 8, 10, 8, 0, 0) }), // further back
  ], { now: NOW });

  const headers = rows.filter((r) => r.type === 'header').map((r) => r.label);
  const olderLabel = new Date(2026, 8, 10, 8, 0, 0).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  assert.deepEqual(headers, [t('activity.today'), t('activity.yesterday'), olderLabel]);

  // Newest item overall comes first, and both today items share one header.
  const order = rows.filter((r) => r.type === 'item').map((r) => r.item.id);
  assert.deepEqual(order, ['b', 'a', 'c', 'd']);
  assert.equal(rows[0].type, 'header');
  assert.equal(rows[1].item.id, 'b');
  assert.equal(rows[2].item.id, 'a');
  assert.equal(rows[3].type, 'header'); // yesterday
});

test('activityRows flags isNew for items strictly after `since`', () => {
  const since = at(2026, 8, 19, 12, 0, 0);
  const rows = activityRows([
    item({ id: 'new', at: at(2026, 8, 20, 0, 0, 0) }),
    item({ id: 'boundary', at: since }),
    item({ id: 'old', at: at(2026, 8, 18, 0, 0, 0) }),
  ], { since, now: NOW });

  const flags = Object.fromEntries(rows.filter((r) => r.type === 'item').map((r) => [r.item.id, r.isNew]));
  assert.deepEqual(flags, { new: true, boundary: false, old: false });
});

test('activityRows marks nothing as new when there are fewer than 2 sign-ins (no watermark)', () => {
  const since = previousSignIn([{ id: '1', signed_in_at: at(2026, 8, 20, 0, 0, 0) }]);
  assert.equal(since, null);
  const rows = activityRows([item({ at: at(2026, 8, 20, 11, 59, 59) })], { since, now: NOW });
  assert.equal(rows.find((r) => r.type === 'item').isNew, false);
});

test('activityRows tolerates null fields on an item without throwing', () => {
  const rows = activityRows([item({ title: null, subtitle: null, body: null, className: null, studentName: null })], { now: NOW });
  const row = rows.find((r) => r.type === 'item');
  assert.equal(row.item.title, null);
  assert.equal(row.item.className, null);
});

test('activityRows drops entries with no `at` rather than crashing on them', () => {
  const rows = activityRows([item({ id: 'ok', at: at(2026, 8, 20, 0, 0, 0) }), item({ id: 'bad', at: null })], { now: NOW });
  const ids = rows.filter((r) => r.type === 'item').map((r) => r.item.id);
  assert.deepEqual(ids, ['ok']);
});

test('activityRows respects an unrecognised kind by leaving it as plain data (rendering degrades it, not the row builder)', () => {
  const rows = activityRows([item({ kind: 'field_trip' })], { now: NOW });
  assert.equal(rows.find((r) => r.type === 'item').item.kind, 'field_trip');
});

test('activityRows caps output at `limit`, keeping the newest items', () => {
  const items = Array.from({ length: ACTIVITY_FEED_LIMIT + 5 }, (_, i) =>
    item({ id: `i${i}`, at: new Date(NOW.getTime() - i * 3600_000).toISOString() }));
  const rows = activityRows(items, { now: NOW, limit: ACTIVITY_FEED_LIMIT });
  const ids = rows.filter((r) => r.type === 'item').map((r) => r.item.id);
  assert.equal(ids.length, ACTIVITY_FEED_LIMIT);
  assert.equal(ids[0], 'i0');
});

const daysAgo = (n) => new Date(2026, 8, 20 - n, 9, 0, 0).toISOString();
const twoSignIns = [{ id: 'l0', signed_in_at: daysAgo(0) }, { id: 'l1', signed_in_at: daysAgo(3) }];

test('activityFeedView reports an empty feed when every item lacks a timestamp', () => {
  const view = activityFeedView([{ id: 'a', kind: 'grade', at: null }, { id: 'b', kind: 'grade' }], twoSignIns, { now: NOW });
  assert.equal(view.isEmpty, true);
  assert.deepEqual(view.rows, []);
  assert.equal(view.newCount, 0, 'nothing is "new" when nothing can be shown');
  assert.equal(view.overflow, 0);
});

test('activityFeedView counts overflow from placeable items only, not raw input', () => {
  const placeable = Array.from({ length: ACTIVITY_FEED_LIMIT + 2 }, (_, i) => ({ id: `p${i}`, kind: 'grade', at: daysAgo(1) }));
  const undated = [{ id: 'u1', kind: 'grade', at: null }, { id: 'u2', kind: 'grade', at: null }];
  const view = activityFeedView([...placeable, ...undated], twoSignIns, { now: NOW });
  assert.equal(view.overflow, 2, 'the two undated items must not inflate "+N more"');
  assert.equal(view.rows.filter((r) => r.type === 'item').length, ACTIVITY_FEED_LIMIT);
});

test('activityFeedView reports no overflow when the feed fits inside the cap', () => {
  const view = activityFeedView([{ id: 'a', kind: 'grade', at: daysAgo(1) }], twoSignIns, { now: NOW });
  assert.equal(view.overflow, 0);
  assert.equal(view.isEmpty, false);
});

test('activityFeedView flags items newer than the previous sign-in', () => {
  const view = activityFeedView([{ id: 'new', kind: 'grade', at: daysAgo(1) }, { id: 'old', kind: 'grade', at: daysAgo(9) }], twoSignIns, { now: NOW });
  assert.equal(view.newCount, 1);
  assert.deepEqual(view.rows.filter((r) => r.type === 'item').map((r) => [r.item.id, r.isNew]), [['new', true], ['old', false]]);
});

test('activityFeedView marks nothing new when there is only one sign-in on record', () => {
  const view = activityFeedView([{ id: 'a', kind: 'grade', at: daysAgo(1) }], [{ id: 'l0', signed_in_at: daysAgo(0) }], { now: NOW });
  assert.equal(view.newCount, 0);
  assert.equal(view.isEmpty, false);
});
