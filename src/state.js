// Overlays (login, palette, compose, check-in, detail) are not redrawn by
// the shell's notify() loop — see overlays.js for why.
import * as api from './api.js';
import { rowKinds, TABS } from './rows.js';

const SIDEBAR_KEY = 'meraki-web.sidebarCollapsed';
function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

const CHAT_MODE_KEY = 'meraki-web.chatMode';
function loadChatMode() {
  try {
    return localStorage.getItem(CHAT_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

// All UI configurability lives in one persisted object rather than scattered
// localStorage keys (like the two above, kept as-is so existing browsers
// don't lose their saved state) — one place to default, reset, and export.
const CONFIG_KEY = 'meraki-web.config';
export const DEFAULT_CONFIG = {
  theme: 'system', // 'system' | 'light' | 'dark'
  accent: 'blue', // 'blue' | 'green' | 'purple' | 'red' | 'orange' | 'pink'
  density: 'comfortable', // 'comfortable' | 'compact'
  timeFormat: '12h', // '12h' | '24h'
  autoRefreshMs: 0, // 0 = off
  hiddenTabs: [],
  tabOrder: [],
  defaultTab: 'overview',
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function persistConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  } catch {
    // best-effort; falls back to defaults next load
  }
}

/** Theme/accent/density are applied as attributes/classes on <html> rather
 * than re-rendered by the shell, so styles.css can own the actual color and
 * spacing values — this just flips the switches CSS reads. */
function applyConfigEffects(config) {
  const root = document.documentElement;
  root.dataset.theme = config.theme === 'system' ? '' : config.theme;
  for (const c of ['blue', 'green', 'purple', 'red', 'orange', 'pink']) root.classList.remove(`accent-${c}`);
  root.classList.add(`accent-${config.accent}`);
  root.classList.toggle('density-compact', config.density === 'compact');
}

let autoRefreshTimer = null;
function restartAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const ms = state.config.autoRefreshMs;
  if (ms > 0) autoRefreshTimer = setInterval(() => { if (isLoggedIn()) refresh(); }, ms);
}

const initialConfig = loadConfig();
applyConfigEffects(initialConfig);

export const state = {
  tab: TABS.some((t) => t.id === initialConfig.defaultTab) ? initialConfig.defaultTab : 'overview',
  config: initialConfig,
  data: emptyData(),
  ownUserId: '',
  ownStudentId: null,
  loading: true,
  // True once the first refresh() has completed — background refreshes
  // (e.g. the reconciling one after an optimistic write) still flip
  // `loading` on/off, but only the very first load shows a spinner; every
  // refresh after that leaves existing content on screen while it updates.
  hasLoadedOnce: false,
  status: 'Loading…',
  error: null,
  selectedIndex: 0,
  // 'palette' | 'compose' | 'checkin' | 'detail' | null
  activeOverlay: null,
  // Set by openCompose() to prefill the compose form (e.g. replying to a
  // message from the context menu); consumed once by buildCompose().
  composePrefill: null,
  detailTarget: null,
  detailBack: null,
  mobileNavOpen: false,
  // Desktop-only, remembered per browser — mobile always uses the full drawer.
  sidebarCollapsed: loadSidebarCollapsed(),
  // Messages-tab-only cosmetic toggle. Remembered per browser, just for fun.
  chatMode: loadChatMode(),
  activeThreadPartnerId: null,
  // Overview's "Due this week" split. Not persisted — resets to the
  // intended default (todo open, done tucked away) on every load rather
  // than remembering a stale collapse state across days.
  overviewCollapse: { todo: false, done: true },
};

function emptyData() {
  return {
    classes: [], assignments: [], grades: [], attendance: [], calendar: [],
    announcements: [], messages: [], portfolio: [], checkins: [],
    hero: null, behaviorNotes: [], detentions: [], reportCards: [],
    assessments: [], discussions: [], fileUploads: [], enrollments: [],
    assignmentSubmissions: [], assessmentSubmissions: [],
  };
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  for (const fn of listeners) fn();
}

export function isLoggedIn() {
  return !!api.getSession();
}

export async function afterLogin() {
  state.ownUserId = api.getSession()?.user_id ?? '';
  restartAutoRefresh();
  await refresh();
}

export function doLogout() {
  api.logout();
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  Object.assign(state, {
    tab: 'overview', data: emptyData(), ownUserId: '', ownStudentId: null,
    loading: true, hasLoadedOnce: false, status: 'Loading…', error: null, selectedIndex: 0,
    activeOverlay: null, detailTarget: null, detailBack: null,
  });
  notify();
}

/** Merges a patch into the persisted UI config, applies its visual/behavioral
 * side effects, and re-renders. Every settings-panel control goes through
 * this one function. */
export function setConfig(patch) {
  Object.assign(state.config, patch);
  persistConfig();
  applyConfigEffects(state.config);
  if ('autoRefreshMs' in patch) restartAutoRefresh();
  notify();
}

export function resetConfig() {
  state.config = { ...DEFAULT_CONFIG };
  persistConfig();
  applyConfigEffects(state.config);
  restartAutoRefresh();
  notify();
}

const TABLES = [
  ['classes', 'classes', 'select=id,name,subject,period,room,term,teacher_id,teacher_name&order=period.asc', 'your classes'],
  ['assignments', 'assignments', 'select=id,title,category,due_date,points_possible,description,submission_mode,class_id,classes(name)&order=due_date.asc', 'assignments'],
  ['grades', 'grades', 'select=id,points_earned,updated_at,assignment_id,assignments(title,points_possible,due_date,class_id)&order=updated_at.desc&limit=69', 'grades'],
  ['attendance', 'attendance', 'select=id,date,status,note&order=date.desc&limit=69', 'attendance'],
  ['calendar', 'calendar_events', 'select=id,title,description,event_date,start_time,end_time,location,category&order=event_date.asc&limit=69', 'the calendar'],
  ['announcements', 'announcements', 'select=id,title,body,created_at&order=created_at.desc&limit=69', 'announcements'],
  ['messages', 'messages', 'select=id,subject,body,created_at,read,sender_id,recipient_id&order=created_at.desc&limit=69', 'messages'],
  ['portfolio', 'portfolio_items', 'select=id,title,description,link,kind,created_at&order=created_at.desc', 'your portfolio'],
  ['checkins', 'checkins', 'select=id,mood,note,date&order=date.desc&limit=69', 'check-ins'],
  ['behaviorNotes', 'behavior_notes', 'select=id,kind,notes,date&order=date.desc&limit=69', 'behavior notes'],
  ['detentions', 'detentions', 'select=id,reason,strike_count,scheduled_date,status,notes&order=scheduled_date.desc', 'detentions'],
  ['reportCards', 'report_cards', 'select=id,class_id,term,grade_pct,letter,comment,published,updated_at&order=updated_at.desc', 'report cards'],
  ['assessments', 'assessments', 'select=id,title,kind,instructions,due_at,time_limit_minutes,published,grammar_check_enabled,assignment_id,class_id,classes(name)&order=due_at.desc&limit=69', 'assessments'],
  ['discussions', 'discussions', 'select=id,title,prompt,due_date,required_replies,graded,points_possible,closed,assignment_id,class_id,classes(name),created_at&order=created_at.desc&limit=69', 'discussions'],
  ['fileUploads', 'file_uploads', 'select=id,title,file_name,mime_type,size_bytes,storage_path,audience,created_at,uploaded_by,class_id,classes(name)&order=created_at.desc&limit=69', 'class files'],
  ['enrollments', 'enrollments', 'select=id,student_id,class_id,students(id,first_name,last_name,grade_level,student_number)&order=class_id.asc', 'class rosters'],
  ['assignmentSubmissions', 'assignment_submissions', 'select=id,assignment_id,submitted_at,status&order=submitted_at.desc&limit=69', 'assignment submissions'],
  ['assessmentSubmissions', 'assessment_submissions', 'select=id,auto_score,manual_score,total_points,submitted_at,assessments(title,class_id,time_limit_minutes)&order=submitted_at.desc&limit=69', 'assessment submissions'],
];

export async function refresh() {
  state.loading = true;
  state.status = 'Refreshing…';
  notify();

  const errors = [];
  const record = (msg) => {
    if (!errors.includes(msg)) errors.push(msg);
  };

  const results = await Promise.allSettled(TABLES.map(([, table, query]) => api.getTable(table, query)));
  results.forEach((r, i) => {
    const [field, , , label] = TABLES[i];
    if (r.status === 'fulfilled') state.data[field] = r.value;
    else record(api.friendlyLoadError(label, r.reason));
  });

  const [heroRes, studentsRes] = await Promise.allSettled([
    api.getTable('hero_profiles', 'select=hero_class,quest_started_at,class_changes'),
    api.getTable('students', 'select=id,first_name,last_name,grade_level'),
  ]);
  if (heroRes.status === 'fulfilled') state.data.hero = heroRes.value[0] ?? null;
  else record(api.friendlyLoadError('your hero profile', heroRes.reason));
  if (studentsRes.status === 'fulfilled') state.ownStudentId = studentsRes.value[0]?.id ?? null;
  else record(api.friendlyLoadError('your student record', studentsRes.reason));

  state.loading = false;
  state.hasLoadedOnce = true;
  state.status = 'Ready.';
  state.error = errors.length ? errors.join('  ') : null;
  const expired = errors.some((e) => e.toLowerCase().includes('log in again'));
  clampSelection();
  notify();
  if (expired) doLogout();
}

let tempSeq = 0;
export function nextTempId() {
  tempSeq += 1;
  return `temp-${Date.now()}-${tempSeq}`;
}

/**
 * Shows a write immediately by splicing a locally-built row into
 * state.data[field], then reconciles in the background: on success, a
 * silent refresh() replaces the whole array with the server's authoritative
 * rows (the temp row is never merged in, just naturally superseded); on
 * failure the temp row is rolled back and the error re-thrown for the
 * caller to surface however fits its UI.
 */
export async function optimisticInsert(field, row, table, apiBody) {
  state.data[field] = [row, ...state.data[field]];
  notify();
  try {
    await api.insertRow(table, apiBody);
    await refresh();
  } catch (err) {
    state.data[field] = state.data[field].filter((r) => r.id !== row.id);
    notify();
    throw err;
  }
}

function rowKindsForCurrentTab() {
  return rowKinds(state.tab, state.data, new Date(), state.overviewCollapse);
}

export function toggleOverviewSection(section) {
  state.overviewCollapse[section] = !state.overviewCollapse[section];
  clampSelection();
  notify();
}

export function currentItemTargets() {
  return rowKindsForCurrentTab()
    .filter((r) => r.type === 'item')
    .map((r) => r.target);
}

function clampSelection() {
  const n = currentItemTargets().length;
  state.selectedIndex = n === 0 ? -1 : Math.min(Math.max(state.selectedIndex, 0), n - 1);
}

export function setTab(tabId) {
  state.tab = tabId;
  state.activeOverlay = null;
  state.selectedIndex = 0;
  state.mobileNavOpen = false;
  clampSelection();
  notify();
}

export function toggleMobileNav() {
  state.mobileNavOpen = !state.mobileNavOpen;
  notify();
}

export function closeMobileNav() {
  state.mobileNavOpen = false;
  notify();
}

export function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  try {
    localStorage.setItem(SIDEBAR_KEY, state.sidebarCollapsed ? '1' : '0');
  } catch {
    // best-effort; falls back to defaulting expanded next load
  }
  notify();
}

export function toggleChatMode() {
  state.chatMode = !state.chatMode;
  try {
    localStorage.setItem(CHAT_MODE_KEY, state.chatMode ? '1' : '0');
  } catch {
    // best-effort; falls back to defaulting off next load
  }
  notify();
}

export function setActiveThread(partnerId) {
  state.activeThreadPartnerId = partnerId;
  notify();
}

export function moveSelection(delta) {
  const n = currentItemTargets().length;
  if (n === 0) return;
  state.selectedIndex = Math.min(Math.max((state.selectedIndex < 0 ? 0 : state.selectedIndex) + delta, 0), n - 1);
  notify();
}

export function openDetailForSelection() {
  const targets = currentItemTargets();
  const t = targets[state.selectedIndex];
  if (!t) return;
  openDetailFor(t);
}

// index is the row's position in the current tab's flat item list (as
// rendered — see rows.js's rowKinds). Passed by a click on a specific row
// so the "selected" highlight follows whatever's actually open in the
// detail panel, instead of staying wherever the keyboard cursor last was.
// Keyboard-driven opens (openDetailForSelection) omit it since
// selectedIndex is already the thing being opened.
export function openDetailFor(target, index = null) {
  if (index !== null) state.selectedIndex = index;
  state.detailTarget = target;
  state.detailBack = null;
  state.activeOverlay = 'detail';
  notify();
}

/** Drill into a sub-item (e.g. an assignment listed inside a class panel)
 * while keeping one level of "back" to return to the panel that opened it. */
export function openSubDetail(target) {
  state.detailBack = state.detailTarget;
  state.detailTarget = target;
  notify();
}

export function detailGoBack() {
  if (!state.detailBack) return;
  state.detailTarget = state.detailBack;
  state.detailBack = null;
  notify();
}

export function closeOverlay() {
  state.activeOverlay = null;
  state.detailBack = null;
  state.composePrefill = null;
  notify();
}

export function openOverlay(name) {
  state.activeOverlay = name;
  notify();
}

/** Opens the compose overlay with an optional recipient/subject prefilled —
 * used by the context menu's "Reply" / "Message teacher" actions. */
export function openCompose(prefill = null) {
  state.composePrefill = prefill;
  state.activeOverlay = 'compose';
  notify();
}
