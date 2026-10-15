const KEY = 'meraki-web.invisible';
const HOUR = 3600 * 1000;

export const INVISIBLE_STOPS = [
  { id: '1h', ms: HOUR },
  { id: '4h', ms: 4 * HOUR },
  { id: '12h', ms: 12 * HOUR },
  { id: '1d', ms: 24 * HOUR },
  { id: '1w', ms: 7 * 24 * HOUR },
  { id: 'always', ms: Infinity },
];
export const DEFAULT_INVISIBLE_STOP = 1;

export function activeInvisible(now = Date.now(), storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    const stop = INVISIBLE_STOPS.findIndex(s => s.id === saved?.stop);
    if (stop < 0) return null;
    if (saved.until !== null && !(saved.until > now)) return null;
    return { stop, until: saved.until };
  } catch { return null; }
}

/** Re-submitting the same choice keeps the running window instead of extending it. */
export function setInvisible(stop, now = Date.now(), storage = globalThis.localStorage) {
  const current = activeInvisible(now, storage);
  if (current?.stop === stop) return current;
  const { id, ms } = INVISIBLE_STOPS[stop];
  const next = { stop: id, until: Number.isFinite(ms) ? now + ms : null };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: applies to this login only */ }
  return { stop, until: next.until };
}

export function clearInvisible(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch { /* storage unavailable */ }
}
