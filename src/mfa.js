// Two-step verification against Supabase Auth's TOTP factors, plus the
// backup codes Meraki's app keeps beside them through server functions (the
// function ids are hashes from its current build, like the ones in api.js, so
// a Meraki deploy can break them). Recovering a lost authenticator, with a
// backup or emailed code, is deliberately left to the official site.
import { SUPABASE_URL, SUPABASE_ANON_KEY, authedFetch, callServerFn, startSession, updateTokens, refreshSession } from './api.js';

const SERVER_FNS = {
  newBackupCodes: '150abfdca47bba770803ae0bcb1f61aca8464c1e4743453d586fdb2b6e6571dc',
  backupCodesLeft: '35e495c29243781cb277b265b35ceebd34c15fac35cf13d0b52cafde85236890',
  clearBackupCodes: 'f91c892b3eaed6ce1c573baf261e553d9bafd69c4f9eb6e7ead9d9091635dd82',
};

export const ISSUER = 'Meraki Education';
export const BACKUP_CODES_PER_SET = 8;

/** The code was wrong or expired, as opposed to the request failing. */
export class WrongCodeError extends Error {}
export class TooManyAttemptsError extends Error {}

// POSTs to Supabase Auth as `token` when given (the half-signed-in tokens of
// a login waiting on its code), otherwise as the stored session.
async function authPost(path, body, token) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const resp = token
    ? await fetch(`${SUPABASE_URL}/auth/v1${path}`, { ...init, headers: { ...init.headers, apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })
    : await authedFetch(`/auth/v1${path}`, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const message = `POST ${path} failed (${resp.status}): ${text.slice(0, 200)}`;
    if (resp.status === 429) throw new TooManyAttemptsError(message);
    throw resp.status === 400 || resp.status === 422 ? new WrongCodeError(message) : new Error(message);
  }
  return resp.json();
}

// Issues a challenge and answers it straight away, as the official site does
// (supabase-js challengeAndVerify), so the challenge can't expire in between.
// Resolves to the aal2 token response.
async function challengeAndVerify(factorId, code, token) {
  const challenge = await authPost(`/factors/${factorId}/challenge`, { factorId }, token);
  return authPost(`/factors/${factorId}/verify`, { challenge_id: challenge.id, code: code.trim() }, token);
}

/** Finishes a password login that stopped for a code (see api.login) with the
 * authenticator's 6-digit code. */
export async function verifyLoginCode(pending, code) {
  const v = await challengeAndVerify(pending.factorId, code, pending.tokens.access_token);
  return startSession(v, pending.email, pending.invisible);
}

async function currentUser() {
  const resp = await authedFetch('/auth/v1/user');
  if (!resp.ok) throw new Error(`GET /auth/v1/user failed (${resp.status})`);
  return resp.json();
}

/** This account's authenticator, as { id, createdAt } or null when two-step
 * verification is off. An enrolment that was never confirmed doesn't count. */
export async function getAuthenticator() {
  const user = await currentUser();
  const factor = (user.factors ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  return factor ? { id: factor.id, createdAt: factor.created_at } : null;
}

export async function getBackupCodesLeft() {
  const result = await callServerFn(SERVER_FNS.backupCodesLeft, undefined);
  return typeof result?.remaining === 'number' ? result.remaining : null;
}

async function authedJson(path, init) {
  const resp = await authedFetch(path, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${init.method} ${path} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/** Starts setting up an authenticator: drops any half-finished enrolment
 * (Supabase allows one at a time), then asks for a fresh factor. Resolves to
 * { id, qrSvg, secret } — the QR as the SVG markup Supabase renders. */
export async function startEnrollment(now = new Date()) {
  const user = await currentUser();
  for (const factor of user.factors ?? []) {
    if (factor.status !== 'verified') await authedJson(`/auth/v1/factors/${factor.id}`, { method: 'DELETE' });
  }
  const factor = await authedJson('/auth/v1/factors', {
    method: 'POST',
    body: JSON.stringify({ friendly_name: `Authenticator ${now.toISOString().slice(0, 10)}`, factor_type: 'totp', issuer: ISSUER }),
  });
  return { id: factor.id, qrSvg: factor.totp.qr_code, secret: factor.totp.secret };
}

/** Confirms the first code from the new authenticator, which turns it on and
 * upgrades this session to match. */
export async function confirmEnrollment(factorId, code) {
  updateTokens(await challengeAndVerify(factorId, code));
}

/** Eight new single-use codes; any earlier set stops working. */
export async function createBackupCodes() {
  const result = await callServerFn(SERVER_FNS.newBackupCodes, undefined);
  return Array.isArray(result?.codes) ? result.codes : [];
}

/** Turns two-step verification off. Needs a current code, as the official
 * site does, and leaves the session on plain password level. */
export async function disableAuthenticator(factorId, code) {
  updateTokens(await challengeAndVerify(factorId, code));
  const resp = await authedFetch(`/auth/v1/factors/${factorId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`DELETE /auth/v1/factors failed (${resp.status})`);
  await callServerFn(SERVER_FNS.clearBackupCodes, undefined).catch(() => {});
  await refreshSession();
}
