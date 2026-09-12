import { notify } from './state.js';

// For details fetched on first view rather than bulk-loaded into state.data
// (a quiz's questions and answers, a submission's annotations): nothing else
// lists them, and re-fetching on every refresh() would be wasted requests for
// a panel that's usually closed. Each key ends up holding the fetched value,
// or { error } if the fetch failed.
const cache = new Map();
const inFlight = new Set();

/** The value for `key`: undefined while `fetcher` is still running (it's
 * started on the first call, and a re-render follows once it settles). */
export function lazyFetch(key, fetcher) {
  if (!cache.has(key) && !inFlight.has(key)) {
    inFlight.add(key);
    fetcher()
      .then((value) => cache.set(key, value))
      .catch((err) => cache.set(key, { error: err.message }))
      .finally(() => {
        inFlight.delete(key);
        notify();
      });
  }
  return cache.get(key);
}
