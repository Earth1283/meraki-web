// Overlays (login, palette, compose, check-in, detail) are not redrawn by
// the shell's notify() loop — see overlays.js for why.
import * as api from './api.js';
import { rowKinds, TAB_IDS } from './rows.js';
import { calendarAgendaKinds } from './calendar.js';

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

// Per-class target grades set on the Analytics tab. Keyed by class id, kept
// separate from config (which is one flat settings object meant to be
// reset/exported as a whole) since this grows one entry per class.
const GRADE_TARGETS_KEY = 'meraki-web.gradeTargets';
function loadGradeTargets() {
  try {
    const raw = localStorage.getItem(GRADE_TARGETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// All UI configurability lives in one persisted object rather than scattered
// localStorage keys (like the two above, kept as-is so existing browsers
// don't lose their saved state) — one place to default, reset, and export.
const CONFIG_KEY = 'meraki-web.config';
export const DEFAULT_CONFIG = {
  theme: 'system', // 'system' | 'light' | 'dark'
  accent: 'yellow', // highlighter color: 'yellow' | 'green' | 'blue' | 'purple' | 'red' | 'orange' | 'pink'
  density: 'comfortable', // 'comfortable' | 'compact'
  style: 'normal', // 'normal' | 'notebook' (hand-drawn marks, see NOTEBOOK_STYLE.md)
  timeFormat: '12h', // '12h' | '24h'
  autoRefreshMs: 0, // 0 = off
  hiddenTabs: [],
  tabOrder: [],
  defaultTab: 'overview',
  chartMode: 'simple', // 'simple' (hand-rolled inline SVG) | 'echarts' (lazy-loaded ECharts)
  calendarView: 'grid', // 'grid' (stylized month view) | 'list' (flat row list)
  calendarShowAssignments: true, // overlay assignment due_dates onto the calendar grid
  gradingScale: 'standard', // 'standard' (school profile table) | 'legacy' (tens digit = letter, ones digit = +/-), see grading.js
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Student-authored reminders shown on the Calendar tab, kept entirely
// client-side since there's no calendar-write endpoint (and no reason a
// student's personal to-dos should land in the school's shared calendar
// table). Same storage shape as gradeTargets above.
const CALENDAR_REMINDERS_KEY = 'meraki-web.calendarReminders';
function loadCalendarReminders() {
  try {
    const raw = localStorage.getItem(CALENDAR_REMINDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistCalendarReminders() {
  try {
    localStorage.setItem(CALENDAR_REMINDERS_KEY, JSON.stringify(state.calendarReminders));
  } catch {
    // best-effort; falls back to an empty list next load
  }
}

function persistConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  } catch {
    // best-effort; falls back to defaults next load
  }
}

// Notebook style's handwritten headings fall back to ZCOOL KuaiLe for CJK text
// (Recursive has no CJK glyphs). The stylesheet is only requested once someone
// turns the style on, and Google Fonts splits the font by unicode-range, so a
// reader who never renders CJK in it never downloads a glyph file.
const HAND_FONT_CJK_HREF = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap';
function ensureHandFont() {
  if (document.getElementById('hand-font-cjk')) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { id: 'hand-font-cjk', rel: 'stylesheet', href: HAND_FONT_CJK_HREF }));
}

/** Theme/accent/density are applied as attributes/classes on <html> rather
 * than re-rendered by the shell, so styles.css can own the actual color and
 * spacing values — this just flips the switches CSS reads. */
function applyConfigEffects(config) {
  const root = document.documentElement;
  root.dataset.theme = config.theme === 'system' ? '' : config.theme;
  for (const c of ['yellow', 'blue', 'green', 'purple', 'red', 'orange', 'pink']) root.classList.remove(`accent-${c}`);
  root.classList.add(`accent-${config.accent}`);
  root.classList.toggle('density-compact', config.density === 'compact');
  root.classList.toggle('style-notebook', config.style === 'notebook');
  if (config.style === 'notebook') ensureHandFont();
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
  tab: TAB_IDS.includes(initialConfig.defaultTab) ? initialConfig.defaultTab : 'overview',
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
  // Only populated during the first load (see STEP_GROUPS); empty otherwise.
  loadingSteps: [],
  error: null,
  selectedIndex: 0,
  // 'palette' | 'compose' | 'checkin' | 'reminder' | 'portfolio' | 'help' | 'settings' | 'detail' | null
  activeOverlay: null,
  // Set by openCompose() to prefill the compose form (e.g. replying to a
  // message from the context menu); consumed once by buildCompose().
  composePrefill: null,
  // Set by openReminderForm() to prefill the add-reminder form's date
  // (e.g. from clicking/right-clicking a day on the calendar grid).
  reminderPrefill: null,
  detailTarget: null,
  // Stack of targets to return to, most-recent last — lets openSubDetail
  // nest arbitrarily deep (e.g. class -> assignment -> further drill-down)
  // instead of capping "back" at one level. Compose/check-in/settings never
  // push onto this: they're terminal action forms with nothing to drill
  // into, so they never show a back button — only the detail panel does.
  detailBackStack: [],
  mobileNavOpen: false,
  // Desktop-only, remembered per browser — mobile always uses the full drawer.
  sidebarCollapsed: loadSidebarCollapsed(),
  // Messages-tab-only cosmetic toggle. Remembered per browser, just for fun.
  chatMode: loadChatMode(),
  // { [classId]: targetPct } for the Analytics tab's grade-goal calculator.
  gradeTargets: loadGradeTargets(),
  // [{ id, title, date, note }] personal due-date reminders on the Calendar tab.
  calendarReminders: loadCalendarReminders(),
  // { [classId]: { scores: { [assignmentId]: points }, extra: { earned, possible }, open } }
  // for the Analytics tab's What if calculator. Not persisted: a what-if is
  // scratch work, and one left over from last week would read as a real grade.
  whatIf: {},
  // The Calendar grid's visible month, not persisted — always opens on
  // today's month rather than remembering wherever it was last navigated to.
  calendarViewMonth: (() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; })(),
  // iso date ('YYYY-MM-DD') of the day selected in the calendar grid, whose
  // items are shown in the day panel below it.
  calendarSelectedDate: new Date().toISOString().slice(0, 10),
  activeThreadPartnerId: null,
  // Overview's "Due this week" split. Not persisted — resets to the
  // intended default (todo open, done tucked away) on every load rather
  // than remembering a stale collapse state across days.
  overviewCollapse: { todo: false, done: true, calendarPast: true },
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
    activeOverlay: null, detailTarget: null, detailBackStack: [], whatIf: {},
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
  ['grades', 'grades', 'select=id,points_earned,comment,updated_at,assignment_id,assignments(title,points_possible,due_date,class_id)&order=updated_at.desc&limit=69', 'grades'],
  ['attendance', 'attendance', 'select=id,date,status,note&order=date.desc&limit=69', 'attendance'],
  ['calendar', 'calendar_events', 'select=id,title,description,event_date,start_time,end_time,location,category&order=event_date.asc&limit=69', 'the calendar'],
  ['announcements', 'announcements', 'select=id,title,body,created_at&order=created_at.desc&limit=69', 'announcements'],
  ['messages', 'messages', 'select=id,subject,body,created_at,read,sender_id,recipient_id&order=created_at.desc&limit=69', 'messages'],
  ['portfolio', 'portfolio_items', 'select=id,title,description,link,kind,created_at&order=created_at.desc', 'your portfolio'],
  ['checkins', 'checkins', 'select=id,mood,note,date&order=date.desc&limit=69', 'check-ins'],
  ['behaviorNotes', 'behavior_notes', 'select=id,kind,notes,date,students(first_name,last_name)&order=date.desc&limit=69', 'behavior notes'],
  ['detentions', 'detentions', 'select=id,reason,strike_count,scheduled_date,status,notes&order=scheduled_date.desc', 'detentions'],
  ['reportCards', 'report_cards', 'select=id,class_id,term,grade_pct,letter,comment,published,updated_at&order=updated_at.desc', 'report cards'],
  ['assessments', 'assessments', 'select=id,title,kind,instructions,due_at,time_limit_minutes,published,grammar_check_enabled,assignment_id,class_id,classes(name)&order=due_at.desc&limit=69', 'assessments'],
  ['discussions', 'discussions', 'select=id,title,prompt,due_date,required_replies,graded,points_possible,closed,assignment_id,class_id,classes(name),created_at&order=created_at.desc&limit=69', 'discussions'],
  ['fileUploads', 'file_uploads', 'select=id,title,file_name,mime_type,size_bytes,storage_path,audience,created_at,uploaded_by,class_id,classes(name)&order=created_at.desc&limit=69', 'class files'],
  ['enrollments', 'enrollments', 'select=id,student_id,class_id,students(id,first_name,last_name,grade_level,student_number)&order=class_id.asc', 'class rosters'],
  ['assignmentSubmissions', 'assignment_submissions', 'select=id,assignment_id,submitted_at,status,body,teacher_note,file_upload_id,file_uploads(id,file_name,storage_path)&order=submitted_at.desc&limit=69', 'assignment submissions'],
  ['assessmentSubmissions', 'assessment_submissions', 'select=id,auto_score,manual_score,total_points,submitted_at,assessments(title,class_id,time_limit_minutes)&order=submitted_at.desc&limit=69', 'assessment submissions'],
];

// refresh() awaits these in order (each group's fields still fetched in
// parallel) so the loading checklist advances step by step instead of a
// 19-way Promise.allSettled resolving in a single flicker. 'auth' has no
// fields — login() already succeeded by the time refresh() runs.
const STEP_GROUPS = [
  { id: 'auth', labelKey: 'loading.step.auth' },
  { id: 'core', labelKey: 'loading.step.core', fields: ['classes', 'calendar', 'enrollments', 'attendance'] },
  {
    id: 'academics',
    labelKey: 'loading.step.academics',
    fields: ['assignments', 'grades', 'reportCards', 'assessments', 'assignmentSubmissions', 'assessmentSubmissions'],
  },
  { id: 'comms', labelKey: 'loading.step.comms', fields: ['announcements', 'messages', 'discussions'] },
  { id: 'extras', labelKey: 'loading.step.extras', fields: ['portfolio', 'checkins', 'behaviorNotes', 'detentions', 'fileUploads'] },
];

function setStepStatus(id, status) {
  const step = state.loadingSteps.find((s) => s.id === id);
  if (step) step.status = status;
}

export async function refresh() {
  state.loading = true;
  state.status = 'Refreshing…';
  const isFirstLoad = !state.hasLoadedOnce;
  if (isFirstLoad) {
    state.loadingSteps = STEP_GROUPS.map((g, i) => ({ id: g.id, labelKey: g.labelKey, status: i === 0 ? 'done' : 'pending' }));
  }
  notify();

  const errors = [];
  const record = (msg) => {
    if (!errors.includes(msg)) errors.push(msg);
  };
  const tableByField = new Map(TABLES.map((t) => [t[0], t]));

  for (const group of STEP_GROUPS) {
    if (group.id === 'auth') continue;
    if (isFirstLoad) {
      setStepStatus(group.id, 'active');
      notify();
    }

    const results = await Promise.allSettled(group.fields.map((field) => {
      const [, table, query] = tableByField.get(field);
      return api.getTable(table, query);
    }));
    results.forEach((r, i) => {
      const field = group.fields[i];
      const [, , , label] = tableByField.get(field);
      if (r.status === 'fulfilled') state.data[field] = r.value;
      else record(api.friendlyLoadError(label, r.reason));
    });

    if (group.id === 'extras') {
      const [heroRes, studentsRes] = await Promise.allSettled([
        api.getTable('hero_profiles', 'select=hero_class,quest_started_at,class_changes'),
        api.getTable('students', 'select=id,first_name,last_name,grade_level'),
      ]);
      if (heroRes.status === 'fulfilled') state.data.hero = heroRes.value[0] ?? null;
      else record(api.friendlyLoadError('your hero profile', heroRes.reason));
      if (studentsRes.status === 'fulfilled') state.ownStudentId = studentsRes.value[0]?.id ?? null;
      else record(api.friendlyLoadError('your student record', studentsRes.reason));
    }

    if (isFirstLoad) {
      setStepStatus(group.id, 'done');
      notify();
    }
  }

  state.loading = false;
  state.hasLoadedOnce = true;
  state.status = 'Ready.';
  state.loadingSteps = [];
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
 * caller to surface however fits its UI. With `returnId`, resolves to the
 * new row's server-side id once the insert lands.
 */
export async function optimisticInsert(field, row, table, apiBody, { returnId = false } = {}) {
  state.data[field] = [row, ...state.data[field]];
  notify();
  try {
    const id = await api.insertRow(table, apiBody, { returnId });
    await refresh();
    return id;
  } catch (err) {
    state.data[field] = state.data[field].filter((r) => r.id !== row.id);
    notify();
    throw err;
  }
}

/** The delete counterpart of optimisticInsert: drops the row locally at
 * once, deletes it on the server, then reconciles with a silent refresh().
 * On failure the row goes back where it was and the error is re-thrown. */
export async function optimisticDelete(field, id, table) {
  const index = state.data[field].findIndex((r) => r.id === id);
  if (index === -1) return;
  const row = state.data[field][index];
  state.data[field] = state.data[field].filter((r) => r.id !== id);
  clampSelection();
  notify();
  try {
    await api.deleteRow(table, id);
    await refresh();
  } catch (err) {
    const rows = state.data[field].filter((r) => r.id !== id);
    rows.splice(Math.min(index, rows.length), 0, row);
    state.data[field] = rows;
    notify();
    throw err;
  }
}

export function rowKindsForCurrentTab() {
  // The calendar's list view merges in assignment due dates and local
  // reminders (which rowKinds' per-tab data doesn't have), so calendar.js
  // builds it.
  if (state.tab === 'calendar') {
    return calendarAgendaKinds({ data: state.data, config: state.config, reminders: state.calendarReminders, collapse: state.overviewCollapse, today: new Date() });
  }
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

export function setGradeTarget(classId, pct) {
  state.gradeTargets = { ...state.gradeTargets, [classId]: pct };
  try {
    localStorage.setItem(GRADE_TARGETS_KEY, JSON.stringify(state.gradeTargets));
  } catch {
    // best-effort; falls back to the default target next load
  }
  notify();
}

/** Stores a class's What if entry without re-rendering: the What if inputs
 * patch their own results in place, and a notify() (which rebuilds the whole
 * tab) would pull focus out of the field being typed in. */
export function setWhatIf(classId, entry) {
  state.whatIf = { ...state.whatIf, [classId]: entry };
}

/** Empties a class's What if scores, leaving its panel open. */
export function clearWhatIf(classId) {
  state.whatIf = { ...state.whatIf, [classId]: { open: true } };
  notify();
}

export function addCalendarReminder({ title, date, note }) {
  const reminder = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, date, note: note || null };
  state.calendarReminders = [...state.calendarReminders, reminder];
  persistCalendarReminders();
  notify();
  return reminder;
}

export function removeCalendarReminder(id) {
  state.calendarReminders = state.calendarReminders.filter((r) => r.id !== id);
  persistCalendarReminders();
  notify();
}

export function setCalendarViewMonth(year, month) {
  // Normalize an out-of-range month (e.g. -1 or 12 from prev/next
  // navigation) into a valid year/month pair instead of requiring every
  // caller to do that arithmetic itself.
  const d = new Date(year, month, 1);
  state.calendarViewMonth = { year: d.getFullYear(), month: d.getMonth() };
  notify();
}

export function setCalendarSelectedDate(iso) {
  state.calendarSelectedDate = iso;
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
  state.detailBackStack = [];
  state.activeOverlay = 'detail';
  notify();
}

/** Drill into a sub-item (e.g. an assignment listed inside a class panel),
 * pushing the current target onto the back stack so any number of nested
 * drill-downs can be unwound one at a time. */
export function openSubDetail(target) {
  state.detailBackStack.push(state.detailTarget);
  state.detailTarget = target;
  notify();
}

export function detailGoBack() {
  if (state.detailBackStack.length === 0) return;
  state.detailTarget = state.detailBackStack.pop();
  notify();
}

export function closeOverlay() {
  state.activeOverlay = null;
  state.detailBackStack = [];
  state.composePrefill = null;
  state.reminderPrefill = null;
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

/** Opens the add-reminder overlay, optionally prefilled with a date —
 * used by the calendar grid's day cells (click "+" / context menu). */
export function openReminderForm(prefillDate = null) {
  state.reminderPrefill = prefillDate;
  state.activeOverlay = 'reminder';
  notify();
}
