import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, getSession } from '../src/api.js';
import { verifyLoginCode, startEnrollment, confirmEnrollment, WrongCodeError, TooManyAttemptsError } from '../src/mfa.js';

const factor = (status) => ({ id: 'f1', factor_type: 'totp', status, created_at: '2026-11-12T00:00:00Z' });
const grant = (factors) => ({ access_token: 'aal1', refresh_token: 'r1', user: { id: 'u1', factors } });
const verified = { access_token: 'aal2', refresh_token: 'r2', user: { id: 'u1', factors: [factor('verified')] } };

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

// `routes` maps a "METHOD path" suffix to a response (or a function of the call).
function mockFetch(t, routes) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const call = { url, method, headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    calls.push(call);
    const u = new URL(url);
    const key = Object.keys(routes).find((k) => k === `${method} ${u.pathname}${u.search}` || (k.startsWith('/') && url.endsWith(k)));
    if (!key) return reply(null);
    const r = routes[key];
    return typeof r === 'function' ? r(call) : r;
  };
  t.after(() => { global.fetch = real; });
  return calls;
}

const asBearer = (call) => call.headers.Authorization;

test('a password login for an account with an authenticator is held back, not signed in', async (t) => {
  const calls = mockFetch(t, { 'POST /auth/v1/token?grant_type=password': reply(grant([factor('verified')])) });
  const result = await login('jstudent', 'pw');
  assert.equal(result.mfaRequired, true);
  assert.equal(result.pending.factorId, 'f1');
  assert.equal(getSession(), null);
  assert.equal(calls.some((c) => c.url.endsWith('/rest/v1/login_events')), false);
});

test('an unconfirmed authenticator does not stop a login', async (t) => {
  mockFetch(t, { 'POST /auth/v1/token?grant_type=password': reply(grant([factor('unverified')])) });
  const result = await login('jstudent', 'pw');
  assert.equal(result.mfaRequired, undefined);
  assert.equal(getSession().access_token, 'aal1');
});

test('a correct code challenges then verifies, and only then signs in', async (t) => {
  const calls = mockFetch(t, {
    'POST /auth/v1/token?grant_type=password': reply(grant([factor('verified')])),
    'POST /auth/v1/factors/f1/challenge': reply({ id: 'c1', type: 'totp', expires_at: 1 }),
    'POST /auth/v1/factors/f1/verify': reply(verified),
  });
  const { pending } = await login('jstudent', 'pw');
  const session = await verifyLoginCode(pending, ' 123456 ');
  const challenge = calls.find((c) => c.url.endsWith('/challenge'));
  const verify = calls.find((c) => c.url.endsWith('/verify'));
  assert.deepEqual(challenge.body, { factorId: 'f1' });
  assert.deepEqual(verify.body, { challenge_id: 'c1', code: '123456' });
  assert.equal(asBearer(challenge), 'Bearer aal1');
  assert.equal(session.access_token, 'aal2');
  assert.equal(session.refresh_token, 'r2');
  assert.equal(getSession().user_id, 'u1');
  assert.ok(calls.some((c) => c.url.endsWith('/rest/v1/login_events')), 'expected the sign-in to be recorded');
});

test('an invisible login stays out of login_events after the code step too', async (t) => {
  const calls = mockFetch(t, {
    'POST /auth/v1/token?grant_type=password': reply(grant([factor('verified')])),
    'POST /auth/v1/factors/f1/challenge': reply({ id: 'c1' }),
    'POST /auth/v1/factors/f1/verify': reply(verified),
  });
  const { pending } = await login('jstudent', 'pw', { invisible: true });
  await verifyLoginCode(pending, '123456');
  assert.equal(calls.some((c) => c.url.endsWith('/rest/v1/login_events')), false);
});

test('a rejected code is a WrongCodeError and a throttled one says so', async (t) => {
  mockFetch(t, {
    'POST /auth/v1/token?grant_type=password': reply(grant([factor('verified')])),
    'POST /auth/v1/factors/f1/challenge': reply({ id: 'c1' }),
    'POST /auth/v1/factors/f1/verify': reply({ code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }, 422),
  });
  const { pending } = await login('jstudent', 'pw');
  await assert.rejects(verifyLoginCode(pending, '000000'), WrongCodeError);
  mockFetch(t, { 'POST /auth/v1/factors/f1/challenge': reply({}, 429) });
  await assert.rejects(verifyLoginCode(pending, '000000'), TooManyAttemptsError);
});

test('starting setup clears an unfinished enrolment before asking for a new one', async (t) => {
  const calls = mockFetch(t, {
    'POST /auth/v1/token?grant_type=password': reply(grant([])),
    'GET /auth/v1/user': reply({ id: 'u1', factors: [{ ...factor('unverified'), id: 'old' }, { ...factor('verified'), id: 'keep' }] }),
    'DELETE /auth/v1/factors/old': reply({ id: 'old' }),
    'POST /auth/v1/factors': reply({ id: 'new', totp: { qr_code: '<svg/>', secret: 'S3CRET' } }),
  });
  await login('jstudent', 'pw');
  const enrolment = await startEnrollment(new Date('2026-11-12T10:00:00Z'));
  assert.deepEqual(enrolment, { id: 'new', qrSvg: '<svg/>', secret: 'S3CRET' });
  const writes = calls.filter((c) => /auth\/v1\/factors/.test(c.url) && c.method !== 'GET');
  assert.deepEqual(writes.map((c) => `${c.method} ${c.url.split('/auth/v1')[1]}`), ['DELETE /factors/old', 'POST /factors']);
  assert.deepEqual(writes[1].body, { friendly_name: 'Authenticator 2026-11-12', factor_type: 'totp', issuer: 'Meraki Education' });
});

test('confirming setup swaps the session onto the aal2 tokens', async (t) => {
  mockFetch(t, {
    'POST /auth/v1/token?grant_type=password': reply(grant([])),
    'POST /auth/v1/factors/new/challenge': reply({ id: 'c9' }),
    'POST /auth/v1/factors/new/verify': reply(verified),
  });
  await login('jstudent', 'pw');
  await confirmEnrollment('new', '654321');
  assert.equal(getSession().access_token, 'aal2');
  assert.equal(getSession().refresh_token, 'r2');
  assert.equal(getSession().user_id, 'u1');
});
