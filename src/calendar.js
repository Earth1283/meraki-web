import { el, svgIcon } from './dom.js';
import { t } from './i18n.js';
import { iconPaths } from './icons.js';
import { renderItemBody } from './rows.js';
import { seededRandom, sketchLine, sketchCircle, sketchBox, sketchGrid, sketchSvg } from './sketch.js';

/** Normalizes any date-ish string (a bare date, or a timestamp) down to its
 * 'YYYY-MM-DD' day so calendar_events, assignments, and reminders can all be
 * bucketed onto the same grid regardless of which precision each one stores. */
export function toIsoDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

export function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A fixed 6x7 grid of days covering `month`, padded with the tail of the
 * previous month and the head of the next so the grid never resizes as the
 * user navigates between short and long months. */
export function monthCells(year, month, today = new Date()) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 (Sun) - 6 (Sat)
  const gridStart = new Date(year, month, 1 - startOffset);
  const todayIso = isoOf(today);
  const todayMonth = todayIso.slice(0, 7);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const iso = isoOf(date);
    return {
      date,
      iso,
      inMonth: date.getMonth() === month,
      isToday: iso === todayIso,
      // Days of today's own month that have already gone by, which the
      // Notebook style crosses off. Scoped to today's month so paging back
      // through old months doesn't bury every cell under pencil slashes.
      isElapsed: iso < todayIso && iso.startsWith(todayMonth),
    };
  });
}

/** Pulls a 24h "HH:MM" out of whatever date/time-ish value an item carries —
 * a calendar_event's separate start_time ("14:30:00"), or a timestamp
 * embedded in a date column ("2026-02-12T09:00:00Z") — falling back to
 * '00:00' for the (common) case of a bare date with no time at all, so
 * every item sorts and displays consistently regardless of source. */
export function extractTime(raw) {
  if (!raw) return null;
  const match = String(raw).match(/T?(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function bucketBy(list, dateOf, toItem) {
  const map = new Map();
  list.forEach((entry, index) => {
    const iso = toIsoDate(dateOf(entry));
    if (!iso) return;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(toItem(entry, index));
  });
  return map;
}

/** Merges calendar_events, (optionally) assignment due dates, and local
 * reminders into one map of iso date -> items ordered by time (events, then
 * assignments, then reminders at equal times). Shared by the month grid and
 * the list view. Assignments aren't pre-filtered: bucketBy already skips
 * undated entries, and filtering first would shift the indices that
 * { kind: 'assignment', index } targets point at. */
function itemsByDay({ data, config, reminders }) {
  const maps = [
    bucketBy(data.calendar, (e) => e.event_date, (e, index) => ({ kind: 'calendarEvent', index, title: e.title, time: extractTime(e.start_time) ?? '00:00' })),
    config.calendarShowAssignments
      ? bucketBy(data.assignments, (a) => a.due_date, (a, index) => ({ kind: 'assignment', index, title: a.title, time: extractTime(a.due_date) ?? '00:00' }))
      : new Map(),
    bucketBy(reminders, (r) => r.date, (r) => ({ kind: 'reminder', reminder: r, title: r.title, time: extractTime(r.date) ?? '00:00' })),
  ];
  const days = new Map();
  for (const map of maps) {
    for (const [iso, items] of map) days.set(iso, [...(days.get(iso) ?? []), ...items]);
  }
  for (const items of days.values()) items.sort((a, b) => a.time.localeCompare(b.time));
  return days;
}

/** One month's grid cells with their merged items. Pure and data-only so
 * it's testable without touching the DOM. */
export function buildCalendarMonth({ year, month, data, config, reminders, today = new Date() }) {
  const byDay = itemsByDay({ data, config, reminders });
  const cells = monthCells(year, month, today).map((cell) => ({ ...cell, items: byDay.get(cell.iso) ?? [] }));
  return { year, month, cells };
}

function agendaDayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The calendar's list view as rowKinds-style rows (rendered by main.js's
 * renderBody, and the source of keyboard selection via state.js): the same
 * merged items as the grid, grouped under day headers. Days before today
 * fold into a collapsible "Earlier" section (collapse.calendarPast, folded
 * unless set false), a 'now' row marks where today falls, and items due
 * within the next 7 days are flagged `soon` for Notebook's highlighters. */
export function calendarAgendaKinds({ data, config, reminders, collapse = {}, today = new Date() }) {
  const days = [...itemsByDay({ data, config, reminders })].sort(([a], [b]) => a.localeCompare(b));
  if (days.length === 0) return [];

  const todayIso = isoOf(today);
  const weekEndIso = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6));
  const toRow = (item, flags) => ({
    type: 'item',
    target: item.kind === 'reminder' ? { kind: 'reminder', reminder: item.reminder } : { kind: item.kind, index: item.index },
    ...flags,
  });

  const rows = [];
  const past = days.filter(([iso]) => iso < todayIso);
  const upcoming = days.filter(([iso]) => iso >= todayIso);
  if (past.length > 0) {
    const collapsed = collapse.calendarPast ?? true;
    const count = past.reduce((n, [, items]) => n + items.length, 0);
    rows.push({ type: 'collapsible-header', section: 'calendarPast', label: t('calendar.earlier'), count, collapsed });
    if (!collapsed) {
      for (const [iso, items] of past) {
        rows.push({ type: 'subheader', label: agendaDayLabel(iso) });
        items.forEach((item) => rows.push(toRow(item, { past: true })));
      }
    }
  }
  rows.push({ type: 'now' });
  if (upcoming.length === 0) rows.push({ type: 'placeholder', text: t('calendar.nothingUpcoming') });
  for (const [iso, items] of upcoming) {
    const isToday = iso === todayIso;
    rows.push({ type: 'header', label: isToday ? `${t('calendar.today')} · ${agendaDayLabel(iso)}` : agendaDayLabel(iso), today: isToday });
    items.forEach((item) => rows.push(toRow(item, { soon: iso <= weekEndIso })));
  }
  return rows;
}

const CHIP_CLASS = { calendarEvent: 'calendar-chip-event', assignment: 'calendar-chip-assignment', reminder: 'calendar-chip-reminder' };

const MAX_VISIBLE_CHIPS = 3;

// Notebook style marks. Each stroke's wobble is seeded by what it marks (the
// day, the month) so rebuilding the grid on every render redraws identical
// strokes instead of jittering.
function dayNumber(cell, { notebook, drawToday }) {
  const num = el('span', { class: 'calendar-day-num', text: String(cell.date.getDate()) });
  if (notebook && cell.isToday) {
    num.appendChild(sketchSvg([sketchCircle(20, 15, 16.5, 11.5, seededRandom(`today:${cell.iso}`))], { viewBox: [40, 30], draw: drawToday, className: 'sketch-today' }));
  }
  return num;
}

function dayMarks(cell, { isSelected, drawSelection }) {
  const marks = [];
  if (cell.isElapsed) {
    marks.push(sketchSvg([sketchLine(0, 100, 100, 0, seededRandom(`slash:${cell.iso}`), { bow: 6, jitter: 4 })], { viewBox: [100, 100], stretch: true, evenStroke: true, className: 'sketch-slash' }));
  }
  if (isSelected) {
    marks.push(sketchSvg(sketchBox(0, 0, 100, 100, seededRandom(`select:${cell.iso}`), { bow: 1.5, overshoot: 2.5, jitter: 1 }), { viewBox: [100, 100], stretch: true, draw: drawSelection, className: 'sketch-select' }));
  }
  return marks;
}

function dayCell(cell, { isSelected, onSelect, onContextMenu, notebook, drawToday, drawSelection }) {
  const visible = cell.items.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = cell.items.length - visible.length;

  const chips = visible.map((item) =>
    el('div', { class: `calendar-chip ${CHIP_CLASS[item.kind]}`, title: `${item.time} ${item.title}` }, [
      el('span', { class: 'calendar-chip-time', text: item.time }),
      el('span', { class: 'calendar-chip-title', text: item.title }),
    ]),
  );
  if (overflow > 0) chips.push(el('div', { class: 'calendar-chip calendar-chip-more', text: t('calendar.moreItems', { n: overflow }) }));

  return el(
    'button',
    {
      type: 'button',
      class: [
        'calendar-day',
        cell.inMonth ? '' : 'calendar-day-outside',
        cell.isToday ? 'calendar-day-today' : '',
        isSelected ? 'calendar-day-selected' : '',
      ].filter(Boolean).join(' '),
      'aria-current': cell.isToday ? 'date' : undefined,
      onclick: () => onSelect(cell.iso),
      oncontextmenu: (e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY, cell);
      },
    },
    [
      ...(notebook ? dayMarks(cell, { isSelected, drawSelection }) : []),
      dayNumber(cell, { notebook, drawToday }),
      chips.length ? el('div', { class: 'calendar-day-chips' }, chips) : null,
    ],
  );
}

function weekdayLabels() {
  // Locale-aware short weekday names (Sun..Sat), matching how the rest of
  // the app formats dates (rows.js's formatDateTime uses toLocaleDateString
  // rather than hand-translated strings) instead of adding 7 more i18n keys.
  const base = new Date(2023, 0, 1); // a Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  });
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayPanel(cell, data, { onOpenDetail, onContextMenuItem, onAddReminder }) {
  if (!cell) return el('div', { class: 'calendar-daypanel-empty', text: t('calendar.pickDay') });

  const label = cell.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const header = el('div', { class: 'calendar-daypanel-header' }, [
    el('h3', { class: 'calendar-daypanel-title', text: label }),
    el(
      'button',
      { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => onAddReminder(cell.iso) },
      [svgIcon(iconPaths('plus')), el('span', { text: t('calendar.addReminder') })],
    ),
  ]);

  if (cell.items.length === 0) {
    return el('div', { class: 'calendar-daypanel' }, [header, el('div', { class: 'calendar-daypanel-empty', text: t('calendar.nothingDue') })]);
  }

  const rows = cell.items.map((item) => {
    if (item.kind === 'reminder') {
      const r = item.reminder;
      return el('div', { class: 'row-item calendar-reminder-row' }, [
        el('div', { class: 'row-item-inner' }, [
          el('div', { class: 'row-top' }, [
            el('span', { class: 'calendar-dot calendar-dot-reminder' }),
            el('span', { class: 'row-title', text: r.title }),
          ]),
          r.note ? el('div', { class: 'row-meta', text: r.note }) : null,
        ]),
        el(
          'button',
          { class: 'btn-icon calendar-reminder-delete', type: 'button', 'aria-label': t('calendar.deleteReminder'), title: t('calendar.deleteReminder'), onclick: (e) => { e.stopPropagation(); onContextMenuItem.delete(r); } },
          [svgIcon(iconPaths('trash'))],
        ),
      ]);
    }
    const target = { kind: item.kind, index: item.index };
    return el(
      'button',
      {
        class: 'row-item',
        type: 'button',
        onclick: () => onOpenDetail(target),
        oncontextmenu: (e) => {
          e.preventDefault();
          onContextMenuItem.row(e.clientX, e.clientY, target);
        },
      },
      [renderItemBody(target, data, null)],
    );
  });

  return el('div', { class: 'calendar-daypanel' }, [header, el('div', { class: 'row-list' }, rows)]);
}

// What the previous Notebook-style render drew, so the next one knows which
// marks are new. Module-level because renderBody() rebuilds the calendar from
// scratch on every state change.
let lastMarks = null;

/** Which Notebook-style marks should draw themselves in on this render. The
 * calendar is rebuilt on every state change (a background refresh, opening a
 * menu), so a mark only animates when what it points at changed: a freshly
 * shown view, a different month, or a new selection. Pure, for tests. */
export function marksToDraw(prev, { fresh, monthKey, selected }) {
  const monthChanged = fresh || !prev || prev.monthKey !== monthKey;
  return { month: monthChanged, today: monthChanged, selection: monthChanged || prev.selected !== selected };
}

/** Builds the full stylized Calendar grid: month header with prev/next/today
 * nav, a weekday-labeled 6-week grid with merged event/assignment/reminder
 * dots per day, and a day panel below listing the selected day's items. */
export function renderCalendarGrid(state, callbacks, { fresh = false } = {}) {
  const { onMonthChange, onToday, onSelectDay, onOpenDetail, onDayContextMenu, onRowContextMenu, onAddReminder, onDeleteReminder } = callbacks;
  const { year, month } = state.calendarViewMonth;
  const grid = buildCalendarMonth({ year, month, data: state.data, config: state.config, reminders: state.calendarReminders, today: new Date() });

  const notebook = state.config.style === 'notebook';
  const monthKey = `${year}-${month}`;
  const draw = marksToDraw(lastMarks, { fresh, monthKey, selected: state.calendarSelectedDate });
  lastMarks = notebook ? { monthKey, selected: state.calendarSelectedDate } : null;

  const monthLabelEl = el('h2', { class: 'calendar-month-label', text: monthLabel(year, month) });
  if (notebook) {
    monthLabelEl.appendChild(sketchSvg([sketchLine(0, 4, 100, 4, seededRandom(`underline:${monthKey}`), { bow: 1.5, overshoot: 2, jitter: 1.2 })], { viewBox: [100, 8], stretch: true, draw: draw.month, className: 'sketch-underline' }));
  }

  const header = el('div', { class: 'calendar-header' }, [
    el('div', { class: 'calendar-header-left' }, [
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.prevMonth'), title: t('calendar.prevMonth'), onclick: () => onMonthChange(-1) }, [svgIcon(iconPaths('chevronLeft'))]),
      monthLabelEl,
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.nextMonth'), title: t('calendar.nextMonth'), onclick: () => onMonthChange(1) }, [svgIcon(iconPaths('chevronRight'))]),
    ]),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onToday, text: t('calendar.today') }),
  ]);

  const weekdayRow = el('div', { class: 'calendar-weekdays' }, weekdayLabels().map((label) => el('span', { text: label })));

  const cellsEl = el('div', { class: 'calendar-grid' }, grid.cells.map((cell) => dayCell(cell, {
    isSelected: cell.iso === state.calendarSelectedDate,
    onSelect: onSelectDay,
    onContextMenu: onDayContextMenu,
    notebook,
    drawToday: draw.today,
    drawSelection: draw.selection,
  })));
  // Rows are equal height (grid-auto-rows: 1fr), so one stretched overlay can
  // rule the whole 7x6 grid instead of every cell drawing its own edges.
  if (notebook) cellsEl.appendChild(sketchSvg(sketchGrid(7, 6, seededRandom(`grid:${monthKey}`)), { viewBox: [700, 600], stretch: true, evenStroke: true, className: 'sketch-grid' }));

  const selectedCell = grid.cells.find((c) => c.iso === state.calendarSelectedDate) ?? null;
  const panel = dayPanel(selectedCell, state.data, {
    onOpenDetail,
    onAddReminder,
    onContextMenuItem: { row: onRowContextMenu, delete: onDeleteReminder },
  });

  const shell = el('div', { class: 'calendar-shell' }, [header, weekdayRow, cellsEl, panel]);
  wireSwipeNav(shell, onMonthChange);
  return shell;
}

// Trackpad horizontal scroll and touch swipe both drive month navigation, on
// top of the arrow buttons — accumulated rather than fired per wheel tick
// (trackpads emit many small deltaX events per gesture) and debounced so one
// swipe changes the month once, not several times.
function wireSwipeNav(shell, onMonthChange) {
  let accumulated = 0;
  let cooldown = false;
  const THRESHOLD = 60;

  shell.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (cooldown) return;
    accumulated += e.deltaX;
    if (Math.abs(accumulated) > THRESHOLD) {
      onMonthChange(accumulated > 0 ? 1 : -1);
      accumulated = 0;
      cooldown = true;
      setTimeout(() => { cooldown = false; }, 350);
    }
  }, { passive: false });

  let touchStartX = null;
  shell.addEventListener('touchstart', (e) => { touchStartX = e.touches[0]?.clientX ?? null; }, { passive: true });
  shell.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    if (Math.abs(dx) > THRESHOLD) onMonthChange(dx > 0 ? -1 : 1);
    touchStartX = null;
  }, { passive: true });
}

export function calendarViewToggle(config, onToggle) {
  const isList = config.calendarView === 'list';
  return el(
    'button',
    {
      class: 'btn-icon',
      type: 'button',
      'aria-label': isList ? t('calendar.switchToGrid') : t('calendar.switchToList'),
      title: isList ? t('calendar.switchToGrid') : t('calendar.switchToList'),
      onclick: () => onToggle(isList ? 'grid' : 'list'),
    },
    [svgIcon(iconPaths(isList ? 'grid' : 'list'))],
  );
}
