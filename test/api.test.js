import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLoadError, classifyLoadError, loadFailure, login, insertRow, deleteRow, updateRow, updateDraftSubmission, uploadFile, getSubmissionAnnotations, getAssessmentQuestions, submitAssessmentAnswers, notifyMessageRecipient, getTablePage, parseContentRangeTotal, APP_URL } from '../src/api.js';
import { decodeSeroval } from '../src/serverfn.js';

const TOKENS = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } };

test('draft sync uses a conditional PATCH and rejects a concurrent turn-in', async (t) => {
  const calls = mockFetch(t, () => ({ json: async () => [] }));
  await login('jstudent', 'password');
  await assert.rejects(updateDraftSubmission('sub1', 's1', { body: 'draft' }), /no longer a draft/);
  const call = calls.at(-1);
  assert.match(call.url, /student_id=eq.s1&status=eq.draft/);
  assert.equal(call.init.method, 'PATCH');
  assert.equal('status' in call.body, false);
});

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
  assert.match(msg, /connection/i);
});

test('anything else maps to a generic retry message naming the label', () => {
  const msg = friendlyLoadError('your portfolio', new Error('GET portfolio_items failed (500): oops'));
  assert.match(msg, /couldn't load your portfolio/i);
});

test('load errors are classified by what actually went wrong', () => {
  const kind = (message) => classifyLoadError(new Error(message));
  assert.deepEqual(kind('token refresh failed (400): {}'), { kind: 'session', status: null });
  assert.deepEqual(kind('Failed to fetch'), { kind: 'network', status: null });
  assert.deepEqual(kind('GET grades failed (403): nope'), { kind: 'denied', status: 403 });
  assert.deepEqual(kind('GET grades failed (404): nope'), { kind: 'missing', status: 404 });
  assert.deepEqual(kind('GET grades failed (429): slow down'), { kind: 'throttled', status: 429 });
  assert.deepEqual(kind('GET grades failed (503): down'), { kind: 'server', status: 503 });
  assert.deepEqual(kind('GET grades failed (400): bad'), { kind: 'http', status: 400 });
  assert.deepEqual(kind('boom'), { kind: 'unknown', status: null });
});

test('a load failure keeps the friendly message and a trimmed copy of the raw error', () => {
  const failure = loadFailure('grades', new Error(`GET grades failed (500):\n${'x'.repeat(500)}`));
  assert.equal(failure.label, 'grades');
  assert.equal(failure.message, friendlyLoadError('grades', new Error('GET grades failed (500)')));
  assert.equal(failure.kind, 'server');
  assert.ok(failure.technical.length <= 300);
  assert.ok(!failure.technical.includes('\n'));
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

test('an invisible login skips the login_events row', async (t) => {
  const calls = mockFetch(t);
  await login('jstudent', 'hunter2', { invisible: true });
  assert.equal(calls.some((c) => c.url.endsWith('/rest/v1/login_events')), false);
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

test("submitAssessmentAnswers calls Meraki's app and decodes the score, sending one response.choice per answer", async (t) => {
  const resultNode = {
    t: 10, i: 1, o: 0,
    p: { k: ['submissionId', 'autoScore', 'totalPoints', 'needsReview'], v: [{ t: 1, s: 'sub-1' }, { t: 0, s: 4 }, { t: 0, s: 4 }, { t: 2, s: 3 }] },
  };
  const calls = mockFetch(t, (url) => (url.startsWith(APP_URL) ? { json: async () => serverFnResponse(resultNode) } : {}));
  await login('jstudent', 'hunter2');
  const result = await submitAssessmentAnswers('quiz-1', [{ questionId: 'q1', choice: 1 }]);
  assert.deepEqual(result, { submissionId: 'sub-1', autoScore: 4, totalPoints: 4, needsReview: false });
  const call = calls.at(-1);
  assert.match(call.url, /^https:\/\/meraki-education\.app\/_serverFn\/7d62ba3d/);
  assert.deepEqual(decodeSeroval(call.body.t).data, { assessmentId: 'quiz-1', answers: [{ questionId: 'q1', response: { choice: 1 } }] });
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
  assert.deepEqual(page, { rows: [{ id: 'g70' }], total: 70, requested: 69 });
  const call = calls.at(-1);
  assert.match(call.url, /\/rest\/v1\/grades\?select=id&order=updated_at\.desc&limit=69&offset=69$/);
  assert.equal(call.init.headers.Prefer, 'count=exact');
});

test('getTable retries a 503 and succeeds on the next attempt', async (t) => {
  let hits = 0;
  mockFetch(t, (url) => {
    if (!url.includes('/rest/v1/assignments')) return {};
    hits += 1;
    return hits === 1 ? { ok: false, status: 503, text: async () => 'upstream' } : { json: async () => [{ id: 'a1' }] };
  });
  await login('jstudent', 'password');
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  t.after(() => { global.setTimeout = realSetTimeout; });
  const { getTable } = await import('../src/api.js');
  assert.deepEqual(await getTable('assignments', 'select=id'), [{ id: 'a1' }]);
  assert.equal(hits, 2);
});

test('the message RPCs POST an empty body and return the rows', async (t) => {
  const calls = mockFetch(t, (url) => (url.includes('/rpc/') ? { json: async () => [{ id: 'x', full_name: 'Joe Doyle', label: 'School administration' }] } : {}));
  await login('jstudent', 'password');
  const { getMessageContacts, getMessageParticipantNames } = await import('../src/api.js');
  assert.equal((await getMessageContacts())[0].full_name, 'Joe Doyle');
  await getMessageParticipantNames();
  const rpcCalls = calls.filter((c) => c.url.includes('/rpc/'));
  assert.match(rpcCalls[0].url, /\/rest\/v1\/rpc\/message_contacts$/);
  assert.match(rpcCalls[1].url, /\/rest\/v1\/rpc\/message_participant_names$/);
  assert.deepEqual(rpcCalls[0].body, {});
});

test('getTablePage drops the exact count, then shrinks the page, when the database times out', async (t) => {
  const timeout = { ok: false, status: 500, text: async () => '{"code":"57014","message":"canceling statement due to statement timeout"}' };
  const calls = mockFetch(t, (url, init) => {
    if (!url.includes('/rest/v1/grades')) return {};
    const counted = init.headers?.Prefer === 'count=exact';
    const small = url.includes('limit=20');
    return counted || !small ? timeout : { json: async () => [{ id: 'g1' }] };
  });
  await login('jstudent', 'password');
  const page = await getTablePage('grades', 'select=id', { limit: 69 });
  const reads = calls.filter((c) => c.url.includes('/rest/v1/grades'));
  assert.equal(reads.length, 3);
  assert.equal(reads[0].init.headers.Prefer, 'count=exact');
  assert.equal(reads[1].init.headers.Prefer, undefined);
  assert.match(reads[2].url, /limit=20/);
  assert.deepEqual(page, { rows: [{ id: 'g1' }], total: null, requested: 20 });
});

test('a statement timeout is classified and worded as the server being slow', () => {
  const err = new Error('GET grades failed (500): {"code":"57014","message":"canceling statement due to statement timeout"}');
  assert.deepEqual(classifyLoadError(err), { kind: 'timeout', status: 500 });
  assert.match(friendlyLoadError('grades', err), /took too long to load grades/);
});
