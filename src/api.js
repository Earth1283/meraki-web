import { encodeServerFnBody, decodeServerFnResponse } from './serverfn.js';

// Public Supabase anon key, same one meraki-education.app ships client-side;
// row-level security, not key secrecy, is what scopes data per user.
export const SUPABASE_URL = 'https://qjzryyxpbofeesmtdpvi.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_A46q6yNO7bKHJO4WqrqCkQ_4K8nO2TY';

// Meraki's own app, for the few things it serves through server functions
// instead of Supabase (see serverfn.js). Each id is a hash from the app's
// current build, so these break whenever Meraki ships a change to that
// function; callers treat a failure as "feature unavailable", never fatal.
export const APP_URL = 'https://meraki-education.app';
const SERVER_FNS = {
  assessmentWithQuestions: '7cb06537c536f77255905af66a89d7c4dfa691e83a9096078709110c3a571da9',
  notifyMessage: 'b6d92294f634873df182796b77a7b3ee247ce7573b4b9c02e05d0ef5f5b82216',
};

const SESSION_KEY = 'meraki-web.session';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let session = loadSession();

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // localStorage unavailable (private mode, quota) — session just won't
    // survive a reload; nothing else to do about it here.
  }
}

export function getSession() {
  return session;
}

export function logout() {
  session = null;
  persist();
}

// Most accounts (especially students) are provisioned as bare usernames on
// the school's own domain — nobody types "@meraki.local" from muscle memory,
// so a plain "something" is assumed to mean "something@meraki.local".
function normalizeEmail(input) {
  const trimmed = input.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed}@meraki.local`;
}

export async function login(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: normalizedEmail, password, gotrue_meta_security: {} }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`login failed (${resp.status}): ${body}`);
  }
  const v = await resp.json();
  if (!v.access_token || !v.refresh_token) throw new Error('no tokens in login response');
  session = {
    access_token: v.access_token,
    refresh_token: v.refresh_token,
    user_id: v.user?.id ?? '',
    email: normalizedEmail,
  };
  persist();
  // The official site records every password sign-in in login_events, which
  // staff can see; doing the same keeps a student who uses this client from
  // looking like they never log in. Best-effort: it mustn't block signing in.
  if (session.user_id) insertRow('login_events', { user_id: session.user_id }).catch(() => {});
  return session;
}

// Single-flight: concurrent 401s from a tab-switch's parallel fetches must
// not each spend the (rotating) refresh token independently.
let refreshPromise = null;

async function ensureFreshToken(staleToken) {
  if (!session) throw new Error('not logged in');
  if (session.access_token !== staleToken) return session.access_token;
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh() {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`token refresh failed (${resp.status}): ${body}`);
  }
  const v = await resp.json();
  session = { ...session, access_token: v.access_token, refresh_token: v.refresh_token };
  persist();
  return session.access_token;
}

async function authedRequest(url, init = {}, extraHeaders = {}) {
  if (!session) throw new Error('not logged in');
  const attempt = (token) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), ...extraHeaders, Authorization: `Bearer ${token}` },
    });

  let resp = await attempt(session.access_token);
  if (resp.status === 401) {
    const fresh = await ensureFreshToken(session.access_token);
    resp = await attempt(fresh);
  }
  return resp;
}

function authedFetch(path, init = {}) {
  return authedRequest(`${SUPABASE_URL}${path}`, init, { apikey: SUPABASE_ANON_KEY });
}

export async function getTable(table, query) {
  const resp = await authedFetch(`/rest/v1/${table}?${query}`);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GET ${table} failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

/** Inserts one row. With `returnId`, has PostgREST echo the new row back (as
 * the official site does before notifying a message's recipient) and
 * resolves to its id. */
export async function insertRow(table, body, { returnId = false } = {}) {
  const resp = await authedFetch(`/rest/v1/${table}${returnId ? '?select=id' : ''}`, {
    method: 'POST',
    headers: returnId
      ? { 'Content-Type': 'application/json', Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' }
      : { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST ${table} failed (${resp.status}): ${text}`);
  }
  if (returnId) return (await resp.json()).id;
  return undefined;
}

// Row-level security doesn't make a DELETE fail when it hides the row —
// PostgREST just reports success having deleted nothing. Asking for the
// deleted rows back is the only way to tell "gone" from "not yours to delete".
export async function deleteRow(table, id) {
  const resp = await authedFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`DELETE ${table} failed (${resp.status}): ${text}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`DELETE ${table} removed nothing`);
}

// Classroom files live in a private storage bucket; a signed URL (short-lived
// download token) is the only way to fetch one, and it has to be requested
// fresh each time — Supabase won't hand out a durable public link for it.
export async function getSignedFileUrl(storagePath, { bucket = 'school-files', expiresIn = 3600 } = {}) {
  const resp = await authedFetch(`/storage/v1/object/sign/${bucket}/${storagePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`sign file failed (${resp.status}): ${body}`);
  }
  const v = await resp.json();
  if (!v.signedURL) throw new Error('no signedURL in response');
  return `${SUPABASE_URL}/storage/v1${v.signedURL}`;
}

// The captured traffic had its auth headers stripped, so sending the Supabase
// access token as a bearer token (the usual TanStack Start + Supabase setup)
// is an assumption until a live call confirms it.
async function callServerFn(id, data) {
  const resp = await authedRequest(`${APP_URL}/_serverFn/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-tsr-serverfn': 'true' },
    body: JSON.stringify(encodeServerFnBody(data)),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`server function failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const { result, error } = decodeServerFnResponse(await resp.json());
  if (error != null) {
    const detail = typeof error === 'object' ? error.message ?? JSON.stringify(error) : String(error);
    throw new Error(`server function error: ${detail}`);
  }
  return result;
}

// assessment_questions itself is unreadable for students (RLS returns it
// empty), but Meraki's app hands a quiz's questions to whoever opens it. Only
// call this for quizzes you've already submitted: it's the same call the site
// makes when a quiz is opened, and whether that also starts the quiz's timer
// isn't known. The questions carry no answer key.
export async function getAssessmentQuestions(assessmentId) {
  const result = await callServerFn(SERVER_FNS.assessmentWithQuestions, { assessmentId });
  return Array.isArray(result?.questions) ? result.questions : [];
}

// Your own recorded answers, scoped to your own submissions the same way the
// rest of this app's tables are.
export async function getAssessmentAnswers(submissionId) {
  return getTable('assessment_answers', `select=id,question_id,response,is_correct,points_awarded,feedback,created_at&submission_id=eq.${submissionId}&order=created_at.asc`);
}

/** Asks Meraki's app to notify a message's recipient, as the official site
 * does right after every send. Resolves to whether it says one went out. */
export async function notifyMessageRecipient(messageId) {
  const result = await callServerFn(SERVER_FNS.notifyMessage, { message_id: messageId });
  return result?.sent === true;
}

export function friendlyLoadError(label, err) {
  const msg = String(err?.message ?? err ?? '');
  if (msg.includes('token refresh failed') || msg.includes('not logged in')) {
    return 'Your session expired. Please log in again.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return `Couldn't reach Meraki while loading ${label}. Check your connection, then retry.`;
  }
  return `Couldn't load ${label}. Try refreshing.`;
}
