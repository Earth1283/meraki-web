import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLoadError, login, insertRow, deleteRow, getAssessmentQuestions, notifyMessageRecipient, APP_URL } from '../src/api.js';

const TOKENS = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } };

// Stands in for fetch for one test: logins get TOKENS, everything else gets
// an empty 200 overridden by whatever `respond(url, init)` returns. Resolves
// to the list of calls made, bodies parsed.
function mockFetch(t, respond = () => ({})) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => TOKENS };
    return { ok: true, status: 200, json: async () => null, text: async () => '', ...respond(url, init) };
  };
  t.after(() => {
    global.fetch = realFetch;
  });
  return calls;
}

// A server function's response body wrapping `result` (already a seroval node).
function serverFnResponse(resultNode, errorNode = { t: 2, s: 1 }) {
  return { t: 10, i: 0, o: 0, p: { k: ['result', 'error', 'context'], v: [resultNode, errorNode, { t: 11, i: 99, o: 0, p: { k: [], v: [] } }] } };
}

test('an expired/failed refresh maps to a re-login message', () => {
  const msg = friendlyLoadError('grades', new Error('token refresh failed (400): {}'));
  assert.match(msg, /log in again/i);
});

test('a browser network failure maps to a connectivity message', () => {
  const msg = friendlyLoadError('grades', new Error('Failed to fetch'));
  assert.match(msg, /couldn't reach meraki/i);
  assert.match(msg, /grades/);
});

test('anything else maps to a generic retry message naming the label', () => {
  const msg = friendlyLoadError('your portfolio', new Error('GET portfolio_items failed (500): oops'));
  assert.match(msg, /couldn't load your portfolio/i);
});

test('login assumes @meraki.local when the input has no domain', async (t) => {
  const calls = mockFetch(t);
  await login('jstudent', 'hunter2');
  assert.equal(calls[0].body.email, 'jstudent@meraki.local');
});

test('login leaves a full email address untouched', async (t) => {
  const calls = mockFetch(t);
  await login('teacher@otherdomain.org', 'hunter2');
  assert.equal(calls[0].body.email, 'teacher@otherdomain.org');
});

test('login records a login_events row, as the official site does', async (t) => {
  const calls = mockFetch(t);
  await login('jstudent', 'hunter2');
  const event = calls.find((c) => c.url.endsWith('/rest/v1/login_events'));
  assert.ok(event, 'expected a login_events insert');
  assert.equal(event.init.method, 'POST');
  assert.deepEqual(event.body, { user_id: 'u1' });
  assert.equal(event.init.headers.Authorization, 'Bearer a');
});

test('insertRow with returnId has PostgREST echo the row back and resolves to its id', async (t) => {
  const calls = mockFetch(t, () => ({ json: async () => ({ id: 'm1' }) }));
  await login('jstudent', 'hunter2');
  assert.equal(await insertRow('messages', { body: 'hi' }, { returnId: true }), 'm1');
  const insert = calls.at(-1);
  assert.match(insert.url, /\/rest\/v1\/messages\?select=id$/);
  assert.equal(insert.init.headers.Prefer, 'return=representation');
});

test('deleteRow resolves once the row comes back deleted', async (t) => {
  const calls = mockFetch(t, (_url, init) => ({ json: async () => (init.method === 'DELETE' ? [{ id: 'p1' }] : null) }));
  await login('jstudent', 'hunter2');
  await deleteRow('portfolio_items', 'p1');
  assert.match(calls.at(-1).url, /\/rest\/v1\/portfolio_items\?id=eq\.p1&select=id$/);
});

test('deleteRow treats a delete that removed nothing as a failure', async (t) => {
  mockFetch(t, (_url, init) => ({ json: async () => (init.method === 'DELETE' ? [] : null) }));
  await login('jstudent', 'hunter2');
  await assert.rejects(deleteRow('portfolio_items', 'p1'), /removed nothing/);
});

test("getAssessmentQuestions calls Meraki's app and decodes the questions", async (t) => {
  const questionsNode = { t: 10, i: 1, o: 0, p: { k: ['assessment', 'questions'], v: [{ t: 2, s: 0 }, { t: 9, i: 2, o: 0, a: [{ t: 10, i: 3, o: 0, p: { k: ['id', 'prompt'], v: [{ t: 1, s: 'q1' }, { t: 1, s: 'Why?' }] } }] }] } };
  const calls = mockFetch(t, (url) => (url.startsWith(APP_URL) ? { json: async () => serverFnResponse(questionsNode) } : {}));
  await login('jstudent', 'hunter2');
  assert.deepEqual(await getAssessmentQuestions('quiz-1'), [{ id: 'q1', prompt: 'Why?' }]);
  const call = calls.at(-1);
  assert.match(call.url, /^https:\/\/meraki-education\.app\/_serverFn\/7cb06537/);
  assert.equal(call.init.headers['x-tsr-serverfn'], 'true');
  assert.equal(call.init.headers.Authorization, 'Bearer a');
  assert.deepEqual(call.body.t.p.v[0].p, { k: ['assessmentId'], v: [{ t: 1, s: 'quiz-1' }] });
});

test('notifyMessageRecipient reports whether Meraki says a notification went out', async (t) => {
  const sentFalse = { t: 10, i: 1, o: 0, p: { k: ['sent'], v: [{ t: 2, s: 3 }] } };
  mockFetch(t, (url) => (url.startsWith(APP_URL) ? { json: async () => serverFnResponse(sentFalse) } : {}));
  await login('jstudent', 'hunter2');
  assert.equal(await notifyMessageRecipient('m1'), false);
});

test('a server function error comes back as a thrown error', async (t) => {
  const errorNode = { t: 10, i: 1, o: 0, p: { k: ['message'], v: [{ t: 1, s: 'Not allowed' }] } };
  mockFetch(t, (url) => (url.startsWith(APP_URL) ? { json: async () => serverFnResponse({ t: 2, s: 1 }, errorNode) } : {}));
  await login('jstudent', 'hunter2');
  await assert.rejects(notifyMessageRecipient('m1'), /Not allowed/);
});
