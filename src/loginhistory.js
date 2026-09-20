// The Data & Privacy tab's sign-in trail: the login_events rows this client
// has always written on every sign-in (see api.js's login()), now read back
// so a student can see the same trail staff can. Pure filtering/shaping
// lives here so it's testable under plain Node; renderLoginHistory is the
// only DOM-touching export, and it owns its own filter as local view state
// (never written to state.js) the same way whatif.js owns its own entries.
import { el, clear, svgIcon } from './dom.js';
import { t, getDateLocale } from './i18n.js';
import { iconPaths } from './icons.js';

export const LOGIN_RANGES = [
  { id: '7d', labelKey: 'logins.range.7d', days: 7 },
  { id: '30d', labelKey: 'logins.range.30d', days: 30 },
  { id: 'all', labelKey: 'logins.range.all', days: null },
];

const DEFAULT_RANGE_ID = LOGIN_RANGES[0].id;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseMs(raw) {
  if (raw === null || raw === undefined) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function dayKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The events with a usable timestamp, within the chosen range, newest
 * first. Anything unparseable or missing is dropped rather than thrown, or
 * sorted, since a bad row here is a database oddity, not "old". */
export function filterLogins(events, { rangeId = DEFAULT_RANGE_ID, now = new Date() } = {}) {
  const range = LOGIN_RANGES.find((r) => r.id === rangeId) ?? LOGIN_RANGES[0];
  const cutoffMs = range.days == null ? null : now.getTime() - range.days * DAY_MS;
  return (events ?? [])
    .map((event) => ({ event, ms: parseMs(event?.signed_in_at) }))
    .filter(({ ms }) => ms !== null && (cutoffMs === null || ms >= cutoffMs))
    .sort((a, b) => b.ms - a.ms)
    .map(({ event }) => event);
}

function dayLabel(iso, now) {
  const todayIso = dayKeyOf(now.getTime());
  if (iso === todayIso) return t('calendar.today');
  if (iso === dayKeyOf(now.getTime() - DAY_MS)) return t('logins.yesterday');
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(getDateLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString(getDateLocale(), { hour: 'numeric', minute: '2-digit' });
}

/** `events` (already filtered to the range worth showing) grouped under day
 * headers, newest day first, matching the { type: 'header' | 'item' |
 * 'placeholder' } idiom calendarAgendaKinds uses in calendar.js. */
export function loginRows(events, { now = new Date() } = {}) {
  const groups = new Map();
  for (const event of events ?? []) {
    const ms = parseMs(event?.signed_in_at);
    if (ms === null) continue;
    const iso = dayKeyOf(ms);
    if (!groups.has(iso)) groups.set(iso, []);
    groups.get(iso).push({ id: event.id, ms });
  }
  if (groups.size === 0) return [{ type: 'placeholder', text: t('logins.empty') }];

  const rows = [];
  for (const [iso, items] of [...groups].sort(([a], [b]) => b.localeCompare(a))) {
    rows.push({ type: 'header', label: dayLabel(iso, now), iso });
    items.sort((a, b) => b.ms - a.ms).forEach((item) => rows.push({ type: 'item', id: item.id, time: timeLabel(item.ms) }));
  }
  return rows;
}

/** Honest, small stats: only what an id + a timestamp can actually tell you
 * (no IP, device or location column exists in login_events). `events` is
 * expected to already be the range-filtered subset. */
export function loginSummary(events, { now = new Date() } = {}) {
  const parsed = (events ?? [])
    .map((event) => parseMs(event?.signed_in_at))
    .filter((ms) => ms !== null);
  const mostRecentMs = parsed.reduce((max, ms) => (max === null || ms > max ? ms : max), null);
  return {
    total: parsed.length,
    distinctDays: new Set(parsed.map(dayKeyOf)).size,
    mostRecentAt: mostRecentMs === null ? null : new Date(mostRecentMs).toISOString(),
  };
}

function renderSummary(summary) {
  if (summary.total === 0) return el('p', { class: 'login-history-summary-empty', text: t('logins.empty') });
  return el('p', { class: 'login-history-summary', text: t('logins.summary', {
    total: summary.total,
    days: summary.distinctDays,
    when: new Date(summary.mostRecentAt).toLocaleString(getDateLocale(), { dateStyle: 'medium', timeStyle: 'short' }),
  }) });
}

function renderRows(rows) {
  const list = el('div', { class: 'login-history-rows' });
  for (const row of rows) {
    if (row.type === 'header') {
      list.appendChild(el('div', { class: 'login-history-day', text: row.label }));
    } else if (row.type === 'placeholder') {
      list.appendChild(el('div', { class: 'login-history-placeholder', text: row.text }));
    } else {
      list.appendChild(
        el('div', { class: 'login-history-row' }, [
          svgIcon(iconPaths('logout')),
          el('span', { class: 'login-history-time', text: row.time }),
        ]),
      );
    }
  }
  return list;
}

/** The Data & Privacy tab's sign-in trail panel: a flat, 3-option range
 * filter (never a nested menu — this is the one thing on the page a person
 * actually wants to slice) over the day-grouped rows above. `loginEvents` is
 * state.data.loginEvents, already newest-first from getLoginHistory(); the
 * chosen range lives only in this closure, not in state.js. */
export function renderLoginHistory(loginEvents, { now = new Date() } = {}) {
  let rangeId = DEFAULT_RANGE_ID;

  const summaryEl = el('div', { class: 'login-history-summary-wrap' });
  const rowsEl = el('div', { class: 'login-history-rows-wrap' });
  const buttons = new Map();

  function refresh() {
    for (const [id, btn] of buttons) {
      const active = id === rangeId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    const filtered = filterLogins(loginEvents, { rangeId, now });
    clear(summaryEl);
    summaryEl.appendChild(renderSummary(loginSummary(filtered, { now })));
    clear(rowsEl);
    rowsEl.appendChild(renderRows(loginRows(filtered, { now })));
  }

  const filterBar = el(
    'div',
    { class: 'segmented login-history-filter', role: 'group', 'aria-label': t('logins.filterLabel') },
    LOGIN_RANGES.map((range) => {
      const btn = el('button', {
        type: 'button',
        class: 'segmented-item',
        'aria-pressed': 'false',
        onclick: () => {
          if (rangeId === range.id) return;
          rangeId = range.id;
          refresh();
        },
        text: t(range.labelKey),
      });
      buttons.set(range.id, btn);
      return btn;
    }),
  );

  refresh();

  return el('section', { class: 'login-history', 'aria-label': t('logins.title') }, [
    el('h3', { class: 'login-history-title', text: t('logins.title') }),
    el('p', { class: 'login-history-desc', text: t('logins.desc') }),
    filterBar,
    summaryEl,
    rowsEl,
  ]);
}
