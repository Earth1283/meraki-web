// Command palette: a typed command model (not the old parallel run/label
// arrays), fuzzy-ranked against both static commands and live content
// (assignments, classes, announcements, messages, assessments), with a small
// recency memory. The scorer/matcher/recency/clamp helpers below are pure —
// no `document`, no state.js import — so they're importable and testable
// under plain Node. state.js touches `document.documentElement` as soon as
// it's evaluated (see applyConfigEffects), which would crash a Node test
// that merely imports this file; buildPalette() below only ever reaches it
// through a dynamic import(), which Node never executes unless buildPalette
// itself is called.
import { el, clear, svgIcon } from './dom.js';
import { iconPaths } from './icons.js';
import { t } from './i18n.js';
import { tabs, formatDate, formatDateTime } from './rows.js';

function isWordChar(ch) {
  return /[a-z0-9]/i.test(ch);
}

// A "boundary" is any position a human would call the start of a word: the
// very first character, the first letter after a separator, or the upper
// case letter that starts a new camelCase word. Acronym and word-start
// bonuses below are both built on this same mask.
function boundaryMask(text) {
  const mask = new Array(text.length).fill(false);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!isWordChar(ch)) continue;
    const prev = text[i - 1];
    if (i === 0 || !isWordChar(prev)) mask[i] = true;
    else if (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) mask[i] = true;
  }
  return mask;
}

function acronymOf(text) {
  const mask = boundaryMask(text);
  let out = '';
  for (let i = 0; i < text.length; i += 1) if (mask[i]) out += text[i];
  return out.toLowerCase();
}

const GAP_PENALTY = 0.6;
const BOUNDARY_BONUS = 6;
const CONSECUTIVE_BONUS = 4;
const PREFIX_BONUS = 12;
const ACRONYM_BONUS = 20;

/**
 * Subsequence fuzzy score of `query` against `text`, or null when `query`
 * isn't even a subsequence of `text` (no match at all). Higher is better.
 * Rewards a prefix match, matches that land on word boundaries, runs of
 * consecutive characters and a whole-query acronym hit ("gtc" -> "Go to
 * Classes"); penalises the gaps between scattered matches.
 */
export function scoreText(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (!text) return null;
  const lower = text.toLowerCase();

  // A single-letter query skips the acronym path — every text's first
  // boundary already scores that letter the same way through the loop
  // below, so treating it as a whole-word acronym match too would just be
  // double-counting the same hit.
  const acronym = q.length > 1 ? acronymOf(text) : '';
  if (acronym && acronym.startsWith(q)) return 100 + ACRONYM_BONUS - (acronym.length - q.length);

  const mask = boundaryMask(text);
  let score = 0;
  let searchFrom = 0;
  let lastIndex = -1;
  for (let i = 0; i < q.length; i += 1) {
    const found = lower.indexOf(q[i], searchFrom);
    if (found === -1) return null;
    score += 10;
    if (mask[found]) score += BOUNDARY_BONUS;
    if (lastIndex !== -1) {
      const gap = found - lastIndex - 1;
      score += gap === 0 ? CONSECUTIVE_BONUS : -gap * GAP_PENALTY;
    }
    lastIndex = found;
    searchFrom = found + 1;
  }
  if (lower.startsWith(q)) score += PREFIX_BONUS;
  score -= lower.length * 0.02;
  return score;
}

/** Recents (in recency order) that still exist among `entries`, then
 * whatever's left of `entries` in their given order, deduplicated and
 * capped — the empty-query view of the palette. */
export function emptyQueryResults(entries, recentIds = [], limit = 8) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set();
  const out = [];
  for (const id of recentIds) {
    const entry = byId.get(id);
    if (!entry || seen.has(id)) continue;
    out.push(entry);
    seen.add(id);
    if (out.length >= limit) return out;
  }
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    out.push(entry);
    seen.add(entry.id);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ranks `entries` (each `{ id, text, ... }`) against `query`, breaking
 * score ties by recency, and caps the result — the one flat, scannable list
 * the palette shows for any given query. An empty query defers to
 * emptyQueryResults instead of scoring everything against nothing. */
export function searchEntries(query, entries, { recentIds = [], limit = 8 } = {}) {
  const q = query.trim();
  if (!q) return emptyQueryResults(entries, recentIds, limit);

  const recencyOf = new Map(recentIds.map((id, i) => [id, i]));
  const scored = [];
  for (const entry of entries) {
    const score = scoreText(q, entry.text);
    if (score == null) continue;
    scored.push({ entry, score, recency: recencyOf.has(entry.id) ? recencyOf.get(entry.id) : Infinity });
  }
  scored.sort((a, b) => b.score - a.score || a.recency - b.recency);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** Clamps a roving selection index to a shrinking or growing result list;
 * -1 (nothing selected) once the list is empty. */
export function clampSelection(index, length) {
  if (length <= 0) return -1;
  return Math.min(Math.max(index, 0), length - 1);
}

const RECENTS_KEY = 'meraki-web.paletteRecents';
const MAX_RECENTS = 8;

export function loadRecentIds() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentId(id) {
  const next = [id, ...loadRecentIds().filter((x) => x !== id)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // best-effort; recents just won't persist across reloads
  }
  return next;
}

const RESULT_LIMIT = 9;

function contentEntries(api, items, kind, textOf, category, icon, hintOf) {
  return (items ?? []).reduce((out, item, index) => {
    const text = textOf(item);
    if (text) {
      out.push({ id: `${kind}:${index}`, text, category, icon, hint: hintOf ? hintOf(item) : null, run: () => api.openDetailFor({ kind, index }) });
    }
    return out;
  }, []);
}

function buildEntries(api) {
  const data = api.state.data ?? {};
  const navigate = t('palette.category.navigate');
  const actions = t('palette.category.actions');

  const commands = [
    ...tabs().map((tb) => ({
      id: `tab:${tb.id}`,
      text: t('palette.goto', { name: tb.title }),
      category: navigate,
      icon: tb.id,
      run: () => api.setTab(tb.id),
    })),
    { id: 'cmd:refresh', text: t('palette.refresh'), category: actions, icon: 'refresh', hint: 'r', run: () => api.refresh() },
    { id: 'cmd:settings', text: t('palette.settings'), category: actions, icon: 'settings', hint: ',', run: () => api.openOverlay('settings') },
    { id: 'cmd:logout', text: t('palette.logout'), category: actions, icon: 'logout', run: () => api.doLogout() },
    { id: 'cmd:compose', text: t('compose.title'), category: actions, icon: 'chat', run: () => api.openCompose() },
    { id: 'cmd:checkin', text: t('checkin.title'), category: actions, icon: 'me', run: () => api.openOverlay('checkin') },
    { id: 'cmd:reminder', text: t('calendar.addReminder'), category: actions, icon: 'calendar', run: () => api.openReminderForm() },
    { id: 'cmd:portfolio', text: t('portfolio.addTitle'), category: actions, icon: 'book', run: () => api.openOverlay('portfolio') },
  ];

  const content = [
    ...contentEntries(api, data.assignments, 'assignment', (a) => a.title, t('palette.category.assignments'), 'assignments', (a) => (a.due_date ? t('field.due', { date: formatDate(a.due_date) }) : null)),
    ...contentEntries(api, data.classes, 'class', (c) => c.name, t('palette.category.classes'), 'classes', (c) => c.teacher_name || c.subject || null),
    ...contentEntries(api, data.announcements, 'announcement', (a) => a.title, t('palette.category.announcements'), 'announcements', (a) => formatDate(a.created_at)),
    ...contentEntries(api, data.messages, 'message', (m) => m.subject || t('field.noSubject'), t('palette.category.messages'), 'messages', (m) => formatDateTime(m.created_at)),
    ...contentEntries(api, data.assessments, 'assessment', (a) => a.title, t('palette.category.assessments'), 'quiz', (a) => (a.due_at ? t('field.due', { date: formatDateTime(a.due_at) }) : null)),
  ];

  return [...commands, ...content];
}

// Lazy + cached: a plain top-level `import('./state.js')` call would fire
// the moment this module loads (import() runs eagerly, it just resolves
// asynchronously), which would crash a Node test run before any test even
// starts, since state.js touches `document` as soon as it's evaluated. Only
// calling import() from inside buildPalette() defers it to when a browser
// actually opens the palette; state.js is already loaded by then (main.js
// and every other overlay import it directly), so the promise below settles
// on the very next microtask.
let stateApiPromise = null;
function loadStateApi() {
  if (!stateApiPromise) stateApiPromise = import('./state.js');
  return stateApiPromise;
}

export function buildPalette() {
  let query = '';
  let selected = 0;
  let entries = [];
  let results = [];
  let api = null;

  const list = el('div', { class: 'cmdk-list' });
  const input = el('input', { class: 'cmdk-input', type: 'text', autocomplete: 'off', placeholder: t('palette.placeholder'), 'aria-label': t('palette.label') });
  const panel = el('div', { class: 'cmdk-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.label') }, [input, list]);
  const backdropEl = el('div', { class: 'overlay-backdrop', onclick: () => api?.closeOverlay() });
  const wrap = el('div', { class: 'overlay-center cmdk-root' }, [backdropEl, panel]);

  function choose(entry) {
    recordRecentId(entry.id);
    api.closeOverlay();
    entry.run();
  }

  function draw() {
    clear(list);
    results = searchEntries(query, entries, { recentIds: loadRecentIds(), limit: RESULT_LIMIT });
    selected = clampSelection(selected, results.length);
    let lastCategory = null;
    let selectedNode = null;
    results.forEach((entry, i) => {
      if (entry.category !== lastCategory) {
        list.appendChild(el('div', { class: 'cmdk-category', text: entry.category }));
        lastCategory = entry.category;
      }
      const node = el(
        'button',
        { class: `cmdk-item ${i === selected ? 'active' : ''}`, type: 'button', onclick: () => choose(entry) },
        [svgIcon(iconPaths(entry.icon)), el('span', { class: 'cmdk-item-label', text: entry.text }), entry.hint ? el('span', { class: 'cmdk-item-hint', text: entry.hint }) : null],
      );
      if (i === selected) selectedNode = node;
      list.appendChild(node);
    });
    if (results.length === 0) list.appendChild(el('div', { class: 'cmdk-empty', text: t('palette.empty') }));
    selectedNode?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    query = input.value;
    selected = 0;
    if (api) draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = clampSelection(selected + 1, results.length);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = clampSelection(selected - 1, results.length);
      draw();
    } else if (e.key === 'Home') {
      e.preventDefault();
      selected = clampSelection(0, results.length);
      draw();
    } else if (e.key === 'End') {
      e.preventDefault();
      selected = clampSelection(results.length - 1, results.length);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selected]) choose(results[selected]);
    } else if (e.key === 'Escape') {
      api?.closeOverlay();
    }
  });

  loadStateApi().then((mod) => {
    api = mod;
    entries = buildEntries(api);
    draw();
  });

  queueMicrotask(() => input.focus());
  return wrap;
}
