import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLoadError, login, insertRow, deleteRow, updateRow, uploadFile, getSubmissionAnnotations, getAssessmentQuestions, notifyMessageRecipient, getTablePage, parseContentRangeTotal, APP_URL } from '../src/api.js';

const TOKENS = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } };

// Stands in for fetch for one test: logins get TOKENS, everything else gets
// an empty 200 overridden by whatever `respond(url, init)` returns. Resolves
// to the list of calls made, bodies parsed.
function mockFetch(t, respond = () => ({})) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
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

test('updateRow patches one row and asks for it back', async (t) => {
  const calls = mockFetch(t, (_url, init) => ({ json: async () => (init.method === 'PATCH' ? [{ id: 's1' }] : null) }));
  await login('jstudent', 'hunter2');
  await updateRow('assignment_submissions', 's1', { status: 'submitted' });
  const call = calls.at(-1);
  assert.match(call.url, /\/rest\/v1\/assignment_submissions\?id=eq\.s1&select=id$/);
  assert.equal(call.init.method, 'PATCH');
  assert.equal(call.init.headers.Prefer, 'return=representation');
  assert.deepEqual(call.body, { status: 'submitted' });
});

test('updateRow treats an update that changed nothing as a failure', async (t) => {
  mockFetch(t, (_url, init) => ({ json: async () => (init.method === 'PATCH' ? [] : null) }));
  await login('jstudent', 'hunter2');
  await assert.rejects(updateRow('assignment_submissions', 's1', { status: 'submitted' }), /changed nothing/);
});

test('uploadFile posts the file as multipart into the bucket without overwriting', async (t) => {
  const calls = mockFetch(t);
  await login('jstudent', 'hunter2');
  const file = new File(['essay text'], 'essay.txt', { type: 'text/plain' });
  await uploadFile('assignments/a1/s1/1-essay.txt', file);
  const call = calls.at(-1);
  assert.match(call.url, /\/storage\/v1\/object\/school-files\/assignments\/a1\/s1\/1-essay\.txt$/);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-upsert'], 'false');
  assert.equal(call.init.headers['Content-Type'], undefined, 'fetch sets the multipart boundary itself');
  assert.ok(call.body instanceof FormData);
  assert.equal(call.body.get('cacheControl'), '3600');
  assert.equal(await call.body.get('').text(), 'essay text');
});

test('uploadFile reports a failed upload', async (t) => {
  mockFetch(t, (url) => (url.includes('/storage/') ? { ok: false, status: 409, text: async () => 'The resource already exists' } : {}));
  await login('jstudent', 'hunter2');
  await assert.rejects(uploadFile('assignments/a1/s1/1-essay.txt', new File(['x'], 'essay.txt')), /upload failed \(409\)/);
});

test('getSubmissionAnnotations reads one submission in reading order', async (t) => {
  const calls = mockFetch(t, () => ({ json: async () => [] }));
  await login('jstudent', 'hunter2');
  await getSubmissionAnnotations('s1');
  assert.match(calls.at(-1).url, /\/rest\/v1\/submission_annotations\?select=[^&]*excerpt[^&]*&submission_id=eq\.s1&order=start_offset\.asc\.nullslast$/);
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

test('parseContentRangeTotal reads the total off a PostgREST Content-Range', () => {
  assert.equal(parseContentRangeTotal('0-68/245'), 245);
  assert.equal(parseContentRangeTotal('*/0'), 0);
  assert.equal(parseContentRangeTotal('0-68/*'), null);
  assert.equal(parseContentRangeTotal(null), null);
});

test('getTablePage asks for one page with an exact count and returns the total', async (t) => {
  const calls = mockFetch(t, () => ({
    json: async () => [{ id: 'g70' }],
    headers: { get: (name) => (name.toLowerCase() === 'content-range' ? '69-69/70' : null) },
  }));
  await login('jstudent', 'hunter2');
  const page = await getTablePage('grades', 'select=id&order=updated_at.desc', { offset: 69, limit: 69 });
  assert.deepEqual(page, { rows: [{ id: 'g70' }], total: 70 });
  const call = calls.at(-1);
  assert.match(call.url, /\/rest\/v1\/grades\?select=id&order=updated_at\.desc&limit=69&offset=69$/);
  assert.equal(call.init.headers.Prefer, 'count=exact');
});
