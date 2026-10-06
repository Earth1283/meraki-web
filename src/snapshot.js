export const SNAPSHOT_VERSION = 1;

const DB_NAME = 'meraki-web';
const STORE = 'snapshots';
const KEY = 'current';

const isTempRow = (row) => typeof row?.id === 'string' && row.id.startsWith('temp-');

export function buildSnapshot({ userId, data, ownStudentId, ownStudentName, now = Date.now() }) {
  const rows = {};
  for (const [field, value] of Object.entries(data)) {
    rows[field] = Array.isArray(value) ? value.filter((row) => !isTempRow(row)) : value;
  }
  return { version: SNAPSHOT_VERSION, userId, savedAt: now, data: rows, ownStudentId, ownStudentName };
}

export function usableSnapshot(snapshot, userId) {
  return !!snapshot && snapshot.version === SNAPSHOT_VERSION && snapshot.userId === userId && !!snapshot.data && Number.isFinite(snapshot.savedAt);
}

export function mergeSnapshotData(emptyData, snapshotData) {
  const merged = { ...emptyData };
  for (const key of Object.keys(emptyData)) {
    if (key in snapshotData && Array.isArray(emptyData[key]) === Array.isArray(snapshotData[key])) merged[key] = snapshotData[key];
  }
  return merged;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarsest-unit age for a relative-time label: { value, unit } with a
 * negative value, ready for Intl.RelativeTimeFormat. */
export function snapshotAge(savedAt, now = Date.now()) {
  const elapsed = Math.max(0, now - savedAt);
  if (elapsed < MINUTE) return { value: 0, unit: 'second' };
  if (elapsed < HOUR) return { value: -Math.floor(elapsed / MINUTE), unit: 'minute' };
  if (elapsed < DAY) return { value: -Math.floor(elapsed / HOUR), unit: 'hour' };
  return { value: -Math.floor(elapsed / DAY), unit: 'day' };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot) {
  try {
    await withStore('readwrite', (store) => store.put(snapshot, KEY));
  } catch {
    // best-effort; the next load just shows the spinner as before
  }
}

export async function loadSnapshot(userId) {
  try {
    const snapshot = await withStore('readonly', (store) => store.get(KEY));
    if (usableSnapshot(snapshot, userId)) return snapshot;
    if (snapshot) await clearSnapshot();
    return null;
  } catch {
    return null;
  }
}

export async function clearSnapshot() {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // nothing stored, or storage unavailable
  }
}
