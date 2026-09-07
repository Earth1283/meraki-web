// Public Supabase anon key, same one meraki-education.app ships client-side;
// row-level security, not key secrecy, is what scopes data per user.
export const SUPABASE_URL = 'https://qjzryyxpbofeesmtdpvi.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_A46q6yNO7bKHJO4WqrqCkQ_4K8nO2TY';

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

async function authedFetch(path, init = {}) {
  if (!session) throw new Error('not logged in');
  const attempt = (token) =>
    fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });

  let resp = await attempt(session.access_token);
  if (resp.status === 401) {
    const fresh = await ensureFreshToken(session.access_token);
    resp = await attempt(fresh);
  }
  return resp;
}

export async function getTable(table, query) {
  const resp = await authedFetch(`/rest/v1/${table}?${query}`);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GET ${table} failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

export async function insertRow(table, body) {
  const resp = await authedFetch(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST ${table} failed (${resp.status}): ${text}`);
  }
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
