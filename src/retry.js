export const REQUEST_TIMEOUT_MS = 20000;
export const RETRY_DELAYS_MS = [500, 1500];
const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

export class TransientHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function isTransient(err) {
  if (err instanceof TransientHttpError) return true;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return true;
  return err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/.test(String(err?.message ?? ''));
}

export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.has(status);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `attempt` again after a short pause when it fails the way a flaky
 * connection does (dropped, timed out, 502/503/504). Anything else (a 4xx,
 * a 429, a bad body) is the server's real answer and is thrown straight away. */
export async function withRetry(attempt, { delays = RETRY_DELAYS_MS, sleep = wait } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= delays.length || !isTransient(err)) throw err;
      await sleep(delays[i]);
    }
  }
}

/** fetch() that gives up after `timeoutMs` instead of hanging on a dead link. */
export function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (init.signal || typeof AbortSignal?.timeout !== 'function') return fetch(url, init);
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
