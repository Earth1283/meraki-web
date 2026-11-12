import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const { login, getSession, signOut, refreshSessionIfDue, authedFetch } = await import('../src/api.js');

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const nowSec = () => Math.floor(Date.now() / 1000);

function mockFetch(t, respond) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, path: `${u.pathname}${u.search}` });
    return respond(calls.at(-1)) ?? reply(null);
  };
  t.after(() => { global.fetch = real; });
  return calls;
}

const grant = (expiresIn, extra = {}) => ({ access_token: 'a1', refresh_token: 'r1', expires_in: expiresIn, user: { id: 'u1' }, ...extra });

test('sign out posts a global sign-out as the session, then empties localStorage', async (t) => {
  const calls = mockFetch(t, (c) => (c.path.includes('grant_type=password') ? reply(grant(3600)) : reply(null, 204)));
  await login('jstudent', 'pw', { invisible: true });
  localStorage.setItem('meraki-web.language', 'fr');
  assert.ok(store.size > 1);
  await signOut();
  const out = calls.find((c) => c.path === '/auth/v1/logout?scope=global');
  assert.equal(out.method, 'POST');
  assert.equal(out.headers.Authorization, 'Bearer a1');
  assert.equal(store.size, 0);
  assert.equal(getSession(), null);
});

test('sign out still clears everything when the server call fails', async (t) => {
  mockFetch(t, (c) => { if (c.path.includes('grant_type=password')) return reply(grant(3600)); throw new TypeError('Failed to fetch'); });
  await login('jstudent', 'pw', { invisible: true });
  await signOut();
  assert.equal(store.size, 0);
  assert.equal(getSession(), null);
});

test('a session close to expiry is refreshed ahead of time, and a fresh one is left alone', async (t) => {
  const calls = mockFetch(t, (c) => (c.path.includes('grant_type=password')
    ? reply(grant(100))
    : reply({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600, user: { id: 'u1' } })));
  await login('jstudent', 'pw', { invisible: true });
  assert.equal(await refreshSessionIfDue(300), true);
  assert.equal(getSession().access_token, 'a2');
  assert.ok(getSession().expires_at > nowSec() + 3000);
  assert.equal(await refreshSessionIfDue(300), false);
  assert.equal(calls.filter((c) => c.path.includes('grant_type=refresh_token')).length, 1);
});

test('an auth server outage during refresh is not an expired session', async (t) => {
  mockFetch(t, (c) => (c.path.includes('grant_type=password') ? reply(grant(100)) : reply({}, 503)));
  await login('jstudent', 'pw', { invisible: true });
  await assert.rejects(refreshSessionIfDue(300), (err) => !/token refresh failed/.test(err.message) && /unavailable/.test(err.message));
  assert.equal(getSession().refresh_token, 'r1');
});

test('a refresh another tab already did is adopted instead of spent again', async (t) => {
  const calls = mockFetch(t, (c) => {
    if (c.path.includes('grant_type=password')) return reply(grant(3600));
    return c.headers.Authorization === 'Bearer a1' ? reply(null, 401) : reply([]);
  });
  await login('jstudent', 'pw', { invisible: true });
  store.set('meraki-web.session', JSON.stringify({ ...JSON.parse(store.get('meraki-web.session')), access_token: 'other-tab', refresh_token: 'rotated', expires_at: nowSec() + 3600 }));
  await authedFetch('/rest/v1/classes');
  assert.equal(calls.some((c) => c.path.includes('grant_type=refresh_token')), false);
  assert.equal(getSession().refresh_token, 'rotated');
});
