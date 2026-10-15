import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeInvisible, setInvisible, clearInvisible, INVISIBLE_STOPS } from '../src/invisible.js';

function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
const HOUR = 3600 * 1000;
const stop = id => INVISIBLE_STOPS.findIndex(s => s.id === id);

test('an invisible window lasts for the chosen duration, then lapses', () => {
  const s = storage();
  setInvisible(stop('4h'), 1000, s);
  assert.equal(activeInvisible(1000 + 4 * HOUR - 1, s)?.stop, stop('4h'));
  assert.equal(activeInvisible(1000 + 4 * HOUR, s), null);
});

test('"always" never lapses', () => {
  const s = storage();
  setInvisible(stop('always'), 0, s);
  assert.equal(activeInvisible(1000 * 24 * 365 * HOUR, s)?.stop, stop('always'));
});

test('choosing the same stop again keeps the running window; a new stop restarts it', () => {
  const s = storage();
  const first = setInvisible(stop('1h'), 0, s);
  assert.equal(setInvisible(stop('1h'), HOUR / 2, s).until, first.until);
  assert.equal(setInvisible(stop('12h'), HOUR / 2, s).until, HOUR / 2 + 12 * HOUR);
});

test('clearing ends it, and junk in storage reads as off', () => {
  const s = storage();
  setInvisible(stop('1d'), 0, s);
  clearInvisible(s);
  assert.equal(activeInvisible(1, s), null);
  s.setItem('meraki-web.invisible', '{"stop":"bogus","until":null}');
  assert.equal(activeInvisible(1, s), null);
});
