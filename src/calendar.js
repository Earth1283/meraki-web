import { el, svgIcon } from './dom.js';
import { t } from './i18n.js';
import { iconPaths } from './icons.js';
import { renderItemBody } from './rows.js';

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

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const iso = isoOf(date);
    return { date, iso, inMonth: date.getMonth() === month, isToday: iso === todayIso };
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
 * reminders into one map of iso date -> ordered items, for a single month's
 * grid. Pure and data-only so it's testable without touching the DOM. */
export function buildCalendarMonth({ year, month, data, config, reminders, today = new Date() }) {
  const eventMap = bucketBy(data.calendar, (e) => e.event_date, (e, index) => ({ kind: 'calendarEvent', index, title: e.title, time: extractTime(e.start_time) ?? '00:00' }));
  const assignmentMap = config.calendarShowAssignments
    ? bucketBy(data.assignments.filter((a) => a.due_date), (a) => a.due_date, (a, index) => ({ kind: 'assignment', index, title: a.title, time: extractTime(a.due_date) ?? '00:00' }))
    : new Map();
  const reminderMap = bucketBy(reminders, (r) => r.date, (r) => ({ kind: 'reminder', reminder: r, title: r.title, time: extractTime(r.date) ?? '00:00' }));

  const cells = monthCells(year, month, today).map((cell) => {
    const items = [...(eventMap.get(cell.iso) ?? []), ...(assignmentMap.get(cell.iso) ?? []), ...(reminderMap.get(cell.iso) ?? [])];
    items.sort((a, b) => a.time.localeCompare(b.time));
    return { ...cell, items };
  });

  return { year, month, cells };
}

const CHIP_CLASS = { calendarEvent: 'calendar-chip-event', assignment: 'calendar-chip-assignment', reminder: 'calendar-chip-reminder' };

const MAX_VISIBLE_CHIPS = 3;

function dayCell(cell, { isSelected, onSelect, onContextMenu }) {
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
      onclick: () => onSelect(cell.iso),
      oncontextmenu: (e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY, cell);
      },
    },
    [
      el('span', { class: 'calendar-day-num', text: String(cell.date.getDate()) }),
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

/** Builds the full stylized Calendar grid: month header with prev/next/today
 * nav, a weekday-labeled 6-week grid with merged event/assignment/reminder
 * dots per day, and a day panel below listing the selected day's items. */
export function renderCalendarGrid(state, callbacks) {
  const { onMonthChange, onToday, onSelectDay, onOpenDetail, onDayContextMenu, onRowContextMenu, onAddReminder, onDeleteReminder } = callbacks;
  const { year, month } = state.calendarViewMonth;
  const grid = buildCalendarMonth({ year, month, data: state.data, config: state.config, reminders: state.calendarReminders, today: new Date() });

  const header = el('div', { class: 'calendar-header' }, [
    el('div', { class: 'calendar-header-left' }, [
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.prevMonth'), title: t('calendar.prevMonth'), onclick: () => onMonthChange(-1) }, [svgIcon(iconPaths('chevronLeft'))]),
      el('h2', { class: 'calendar-month-label', text: monthLabel(year, month) }),
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.nextMonth'), title: t('calendar.nextMonth'), onclick: () => onMonthChange(1) }, [svgIcon(iconPaths('chevronRight'))]),
    ]),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onToday, text: t('calendar.today') }),
  ]);

  const weekdayRow = el('div', { class: 'calendar-weekdays' }, weekdayLabels().map((label) => el('span', { text: label })));

  const cellsEl = el('div', { class: 'calendar-grid' }, grid.cells.map((cell) => dayCell(cell, {
    isSelected: cell.iso === state.calendarSelectedDate,
    onSelect: onSelectDay,
    onContextMenu: onDayContextMenu,
  })));

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
