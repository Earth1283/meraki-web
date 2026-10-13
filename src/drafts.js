// Drafts and preferences belong to an account, even on a shared browser.
const PREFIX = 'meraki-web.draft:';
const PREFS = 'meraki-web.draft-sync:';
export const DEFAULT_DRAFT_SYNC = { mode: 'local', delayMs: 15000, intervalMs: 60000 };
const listeners = new Set();
const memoryPreferences = new Map();
const keyFor = (userId, kind, id) => `${PREFIX}${encodeURIComponent(userId)}:${kind}:${encodeURIComponent(id)}`;

export function readDraft(userId, kind, id, storage = globalThis.localStorage) {
  if (!userId) return null;
  try {
    const draft = JSON.parse(storage.getItem(keyFor(userId, kind, id)));
    if (draft?.version !== 1 || draft.userId !== userId || !Number.isFinite(draft.savedAt)) return null;
    return draft;
  } catch { return null; }
}

export function writeDraft(userId, kind, id, value, storage = globalThis.localStorage) {
  if (!userId) return false;
  try {
    storage.setItem(keyFor(userId, kind, id), JSON.stringify({ ...value, version: 1, userId, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function removeDraft(userId, kind, id, storage = globalThis.localStorage) {
  try { storage.removeItem(keyFor(userId, kind, id)); } catch { /* unavailable storage */ }
}

export function normalizeDraftSync(value = {}) {
  return {
    mode: ['local', 'manual', 'idle', 'interval'].includes(value.mode) ? value.mode : 'local',
    delayMs: [5000, 15000, 30000].includes(value.delayMs) ? value.delayMs : 15000,
    intervalMs: [30000, 60000, 300000].includes(value.intervalMs) ? value.intervalMs : 60000,
  };
}

export function draftSyncPreferences(userId, storage = globalThis.localStorage) {
  try { return normalizeDraftSync(JSON.parse(storage.getItem(PREFS + userId)) ?? {}); }
  catch { return memoryPreferences.get(userId) ?? { ...DEFAULT_DRAFT_SYNC }; }
}

export function setDraftSyncPreferences(userId, patch, storage = globalThis.localStorage) {
  const next = normalizeDraftSync({ ...draftSyncPreferences(userId, storage), ...patch });
  memoryPreferences.set(userId, next);
  try { storage.setItem(PREFS + userId, JSON.stringify(next)); } catch { /* memory-only below */ }
  for (const fn of listeners) fn(userId, next);
  return next;
}

export function onDraftSyncPreferences(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// File bytes go in IndexedDB, away from localStorage's small text quota.
async function attachmentStore(action, key, value) {
  if (!globalThis.indexedDB) throw new Error('File recovery is unavailable');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('meraki-web-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('files');
      const request = action === 'put' ? store.put(value, key) : store[action](key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('File recovery interrupted'));
    });
  } finally { db.close(); }
}

export function saveDraftFile(userId, id, file) {
  const key = keyFor(userId, 'assignment', id);
  return file ? attachmentStore('put', key, { file, name: file.name, lastModified: file.lastModified }) : attachmentStore('delete', key);
}

export async function loadDraftFile(userId, id) {
  const value = await attachmentStore('get', keyFor(userId, 'assignment', id));
  return value ? new File([value.file], value.name, { type: value.file.type, lastModified: value.lastModified }) : null;
}

// One write at a time. Edits made during a write remain dirty, and changing
// the policy cancels scheduled writes without pretending to cancel a request.
export function createDraftSync({ preferences = DEFAULT_DRAFT_SYNC, write, snapshot, active = () => true, changed = () => {}, timers = globalThis }) {
  let prefs = normalizeDraftSync(preferences);
  let timer = null;
  let running = null;
  let revision = 0;
  let stopped = false;
  const status = { dirty: false, syncing: false, syncedAt: null, error: null };
  const cancel = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const schedule = () => {
    cancel();
    if (stopped || !status.dirty || !active() || !['idle', 'interval'].includes(prefs.mode)) return;
    timer = timers.setTimeout(() => { timer = null; sync(); }, prefs.mode === 'idle' ? prefs.delayMs : prefs.intervalMs);
  };
  function sync() {
    if (running) return running;
    cancel();
    if (stopped || !active() || prefs.mode === 'local' || !status.dirty) return Promise.resolve(false);
    const sentRevision = revision;
    const value = snapshot();
    status.syncing = true;
    status.error = null;
    changed(status);
    running = Promise.resolve().then(() => write(value)).then(() => {
      status.dirty = revision !== sentRevision;
      status.syncedAt = Date.now();
      return true;
    }, (error) => { status.error = error; return false; }).finally(() => {
      running = null;
      status.syncing = false;
      changed(status);
      schedule();
    });
    return running;
  }
  return {
    status, sync,
    edit() {
      revision += 1;
      status.dirty = true;
      status.error = null;
      if (prefs.mode === 'idle' || timer === null) schedule();
      changed(status);
    },
    configure(value) { prefs = normalizeDraftSync(value); schedule(); changed(status); },
    stop() { stopped = true; cancel(); },
    resume() { stopped = false; schedule(); },
    settled() { return running ?? Promise.resolve(); },
  };
}
