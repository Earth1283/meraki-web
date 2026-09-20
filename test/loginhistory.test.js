import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_RANGES, filterLogins, loginRows, loginSummary } from '../src/loginhistory.js';
import { i18nReady, t } from '../src/i18n.js';

await i18nReady;

const NOW = new Date(2026, 5, 15, 10, 30, 0); // Mon 2026-06-15 10:30 local
const DAY_MS = 24 * 60 * 60 * 1000;

function isoAt(offsetMs) {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

test('LOGIN_RANGES exposes the presets as data, not a hardcoded switch', () => {
  assert.deepEqual(LOGIN_RANGES.map((r) => r.id), ['7d', '30d', 'all']);
  assert.ok(LOGIN_RANGES.every((r) => typeof r.labelKey === 'string' && r.labelKey.startsWith('logins.')));
  assert.equal(LOGIN_RANGES.find((r) => r.id === 'all').days, null);
});

test('filterLogins keeps only events inside the 7-day window, inclusive at the cutoff', () => {
  const events = [
    { id: 'in-now', signed_in_at: isoAt(0) },
    { id: 'in-cutoff', signed_in_at: isoAt(-7 * DAY_MS) },
    { id: 'out-just-past-cutoff', signed_in_at: isoAt(-7 * DAY_MS - 1) },
    { id: 'out-old', signed_in_at: isoAt(-30 * DAY_MS) },
  ];
  const kept = filterLogins(events, { rangeId: '7d', now: NOW }).map((e) => e.id);
  assert.deepEqual(kept, ['in-now', 'in-cutoff']);
});

test('filterLogins 30-day window is independently bounded from the 7-day one', () => {
  const events = [
    { id: 'in-cutoff', signed_in_at: isoAt(-30 * DAY_MS) },
    { id: 'out-just-past-cutoff', signed_in_at: isoAt(-30 * DAY_MS - 1) },
  ];
  const kept = filterLogins(events, { rangeId: '30d', now: NOW }).map((e) => e.id);
  assert.deepEqual(kept, ['in-cutoff']);
});

test('filterLogins "all" returns every parseable event regardless of age', () => {
  const events = [
    { id: 'recent', signed_in_at: isoAt(0) },
    { id: 'ancient', signed_in_at: isoAt(-3650 * DAY_MS) },
  ];
  const kept = filterLogins(events, { rangeId: 'all', now: NOW }).map((e) => e.id);
  assert.deepEqual(kept.sort(), ['ancient', 'recent']);
});

test('filterLogins drops malformed or missing timestamps instead of throwing or sorting them to the top', () => {
  const events = [
    { id: 'good', signed_in_at: isoAt(0) },
    { id: 'bad-string', signed_in_at: 'not a date' },
    { id: 'null', signed_in_at: null },
    { id: 'missing' },
    {},
  ];
  const kept = filterLogins(events, { rangeId: 'all', now: NOW });
  assert.deepEqual(kept.map((e) => e.id), ['good']);
});

test('filterLogins sorts newest first even when the input is out of order', () => {
  const events = [
    { id: 'oldest', signed_in_at: isoAt(-3 * DAY_MS) },
    { id: 'newest', signed_in_at: isoAt(0) },
    { id: 'middle', signed_in_at: isoAt(-1 * DAY_MS) },
  ];
  const kept = filterLogins(events, { rangeId: '30d', now: NOW }).map((e) => e.id);
  assert.deepEqual(kept, ['newest', 'middle', 'oldest']);
});

test('filterLogins on an empty list returns an empty list', () => {
  assert.deepEqual(filterLogins([], { rangeId: 'all', now: NOW }), []);
  assert.deepEqual(filterLogins(undefined, { rangeId: 'all', now: NOW }), []);
});

test('filterLogins falls back to the default (narrowest) preset for an unknown rangeId', () => {
  const events = [{ id: 'ancient', signed_in_at: isoAt(-3650 * DAY_MS) }, { id: 'recent', signed_in_at: isoAt(0) }];
  assert.deepEqual(filterLogins(events, { rangeId: 'bogus', now: NOW }).map((e) => e.id), ['recent']);
});

test('loginRows groups same-day events under one header, newest day first', () => {
  const events = [
    { id: 'a', signed_in_at: isoAt(0) },
    { id: 'b', signed_in_at: isoAt(-3 * 60 * 60 * 1000) }, // same day, 3h earlier
    { id: 'c', signed_in_at: isoAt(-1 * DAY_MS) }, // previous day
  ];
  const rows = loginRows(events, { now: NOW });
  assert.deepEqual(rows.map((r) => r.type), ['header', 'item', 'item', 'header', 'item']);
  assert.equal(rows[0].label, t('calendar.today'));
  assert.deepEqual(rows.slice(1, 3).map((r) => r.id), ['a', 'b']);
  assert.equal(rows[3].label, t('logins.yesterday'));
  assert.equal(rows[4].id, 'c');
});

test('loginRows drops rows for unparseable timestamps', () => {
  const events = [{ id: 'good', signed_in_at: isoAt(0) }, { id: 'bad', signed_in_at: 'nope' }];
  const rows = loginRows(events, { now: NOW });
  assert.deepEqual(rows.map((r) => r.id).filter(Boolean), ['good']);
});

test('loginRows on an empty list is a single placeholder row', () => {
  assert.deepEqual(loginRows([], { now: NOW }), [{ type: 'placeholder', text: t('logins.empty') }]);
  assert.equal(loginRows([{ id: 'x', signed_in_at: 'garbage' }], { now: NOW })[0].type, 'placeholder');
});

test('loginSummary reports total, distinct days, and the most recent sign-in — nothing invented', () => {
  const events = [
    { id: 'a', signed_in_at: isoAt(0) },
    { id: 'b', signed_in_at: isoAt(-3 * 60 * 60 * 1000) }, // same day as a
    { id: 'c', signed_in_at: isoAt(-1 * DAY_MS) },
  ];
  const summary = loginSummary(events, { now: NOW });
  assert.equal(summary.total, 3);
  assert.equal(summary.distinctDays, 2);
  assert.equal(summary.mostRecentAt, isoAt(0));
  assert.deepEqual(Object.keys(summary).sort(), ['distinctDays', 'mostRecentAt', 'total']);
});

test('loginSummary on an empty list is honestly empty, not zero-filled fiction', () => {
  const summary = loginSummary([], { now: NOW });
  assert.deepEqual(summary, { total: 0, distinctDays: 0, mostRecentAt: null });
});

test('loginSummary ignores malformed timestamps the same way filterLogins does', () => {
  const summary = loginSummary([{ id: 'bad', signed_in_at: 'nope' }, { id: 'missing' }], { now: NOW });
  assert.deepEqual(summary, { total: 0, distinctDays: 0, mostRecentAt: null });
});
