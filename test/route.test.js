import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeOf, historyStep, tabFromHash, hashFor } from '../src/route.js';

const TABS = ['overview', 'grades', 'messages'];
const base = { tab: 'grades', activeOverlay: null, detailTarget: null, detailBackStack: [] };
const route = (patch = {}) => routeOf({ ...base, ...patch });
const detail = (index, stack = []) => route({ activeOverlay: 'detail', detailTarget: { kind: 'grade', index }, detailBackStack: stack });
const entry = (current, from = null) => ({ route: current, from });

test('tabFromHash reads known tabs and rejects the rest', () => {
  assert.equal(tabFromHash('#/messages', TABS), 'messages');
  assert.equal(tabFromHash('#grades', TABS), 'grades');
  assert.equal(tabFromHash('#/nope', TABS), null);
  assert.equal(tabFromHash('', TABS), null);
});

test('hashFor round-trips through tabFromHash', () => {
  assert.equal(tabFromHash(hashFor({ tab: 'overview' }), TABS), 'overview');
});

test('the command palette never becomes a history entry', () => {
  assert.equal(route({ activeOverlay: 'palette' }).overlay, null);
});

test('overlays carry the state they need to reopen', () => {
  assert.deepEqual(route({ activeOverlay: 'compose', composePrefill: { subject: 'Hi' } }).params, { composePrefill: { subject: 'Hi' } });
  assert.equal(route({ activeOverlay: 'settings' }).params, null);
});

test('switching tabs and opening things push new entries', () => {
  assert.equal(historyStep(entry(route()), route({ tab: 'messages' })), 'push');
  assert.equal(historyStep(entry(route()), detail(0)), 'push');
  assert.equal(historyStep(entry(route()), route({ activeOverlay: 'settings' })), 'push');
  assert.equal(historyStep(entry(detail(0), route()), detail(1, [{ kind: 'grade', index: 0 }])), 'push');
  assert.equal(historyStep(entry(detail(0), route()), route({ activeOverlay: 'turnin', turnInAssignmentId: 'a' })), 'push');
});

test('browsing rows while the panel is open replaces the entry', () => {
  assert.equal(historyStep(entry(detail(0), route()), detail(1)), 'replace');
});

test('undoing the step that made an entry goes back instead of piling up', () => {
  assert.equal(historyStep(entry(detail(0), route()), route()), 'back');
  const child = detail(1, [{ kind: 'grade', index: 0 }]);
  assert.equal(historyStep(entry(child, detail(0)), detail(0)), 'back');
});

test('closing something that was never pushed replaces', () => {
  assert.equal(historyStep(entry(detail(0)), route()), 'replace');
});

test('an unchanged route leaves history alone', () => {
  assert.equal(historyStep(entry(detail(0), route()), detail(0)), 'none');
});
