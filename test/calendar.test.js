import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIsoDate, isoOf, monthCells, buildCalendarMonth, extractTime, marksToDraw, calendarAgendaKinds } from '../src/calendar.js';
import { i18nReady } from '../src/i18n.js';

await i18nReady;

// state.js applies theme/accent side effects to `document` on import, which
// doesn't exist under node --test — so this test builds its own minimal
// config instead of importing DEFAULT_CONFIG from state.js.
const CONFIG = { calendarShowAssignments: true };

function dataWith({ calendar = [], assignments = [] } = {}) {
  return {
    classes: [], assignments, grades: [], attendance: [], calendar,
    announcements: [], messages: [], portfolio: [], checkins: [],
    hero: null, behaviorNotes: [], detentions: [], reportCards: [],
    assessments: [], discussions: [], fileUploads: [], enrollments: [],
    assignmentSubmissions: [], assessmentSubmissions: [],
  };
}

test('toIsoDate truncates a timestamp down to its day', () => {
  assert.equal(toIsoDate('2026-03-05T14:30:00Z'), '2026-03-05');
  assert.equal(toIsoDate('2026-03-05'), '2026-03-05');
  assert.equal(toIsoDate(null), null);
});

test('isoOf formats a local Date as YYYY-MM-DD', () => {
  assert.equal(isoOf(new Date(2026, 2, 5)), '2026-03-05');
});

test('monthCells always returns a fixed 6x7 grid padded into neighboring months', () => {
  const cells = monthCells(2026, 1, new Date(2026, 1, 10)); // Feb 2026
  assert.equal(cells.length, 42);
  assert.ok(cells.some((c) => !c.inMonth), 'grid should pad with adjacent-month days');
  assert.equal(cells.filter((c) => c.isToday).length, 1);
  assert.equal(cells.find((c) => c.isToday).iso, '2026-02-10');
});

test('buildCalendarMonth merges calendar events and assignment due dates by day', () => {
  const data = dataWith({
    calendar: [{ id: 'e1', title: 'Pep rally', event_date: '2026-02-12' }],
    assignments: [{ id: 'a1', title: 'Essay', due_date: '2026-02-12T23:59:00Z', class_id: 'c1' }],
  });
  const grid = buildCalendarMonth({ year: 2026, month: 1, data, config: CONFIG, reminders: [], today: new Date(2026, 1, 1) });
  const day12 = grid.cells.find((c) => c.iso === '2026-02-12');
  assert.equal(day12.items.length, 2);
  assert.deepEqual(day12.items.map((i) => i.kind).sort(), ['assignment', 'calendarEvent']);
});

test('buildCalendarMonth hides assignments when calendarShowAssignments is off', () => {
  const data = dataWith({ assignments: [{ id: 'a1', title: 'Essay', due_date: '2026-02-12', class_id: 'c1' }] });
  const grid = buildCalendarMonth({ year: 2026, month: 1, data, config: { ...CONFIG, calendarShowAssignments: false }, reminders: [], today: new Date(2026, 1, 1) });
  const day12 = grid.cells.find((c) => c.iso === '2026-02-12');
  assert.equal(day12.items.length, 0);
});

test('buildCalendarMonth includes local reminders', () => {
  const data = dataWith();
  const reminders = [{ id: 'r1', title: 'Study for quiz', date: '2026-02-20', note: null }];
  const grid = buildCalendarMonth({ year: 2026, month: 1, data, config: CONFIG, reminders, today: new Date(2026, 1, 1) });
  const day20 = grid.cells.find((c) => c.iso === '2026-02-20');
  assert.equal(day20.items.length, 1);
  assert.equal(day20.items[0].kind, 'reminder');
  assert.equal(day20.items[0].reminder.id, 'r1');
});

test('extractTime reads a time out of a start_time column or an embedded timestamp, else null', () => {
  assert.equal(extractTime('14:30:00'), '14:30');
  assert.equal(extractTime('2026-02-12T09:05:00Z'), '09:05');
  assert.equal(extractTime('2026-02-12'), null);
  assert.equal(extractTime(null), null);
});

test('buildCalendarMonth sorts a day\'s items chronologically by HH:MM, undated items first', () => {
  const data = dataWith({
    calendar: [
      { id: 'e1', title: 'Afternoon assembly', event_date: '2026-02-12', start_time: '14:00:00' },
      { id: 'e2', title: 'Morning meeting', event_date: '2026-02-12', start_time: '08:00:00' },
    ],
    assignments: [{ id: 'a1', title: 'Essay (no time)', due_date: '2026-02-12', class_id: 'c1' }],
  });
  const grid = buildCalendarMonth({ year: 2026, month: 1, data, config: CONFIG, reminders: [], today: new Date(2026, 1, 1) });
  const day12 = grid.cells.find((c) => c.iso === '2026-02-12');
  assert.deepEqual(day12.items.map((i) => i.title), ['Essay (no time)', 'Morning meeting', 'Afternoon assembly']);
  assert.deepEqual(day12.items.map((i) => i.time), ['00:00', '08:00', '14:00']);
});

test('monthCells crosses off only the already-gone days of today\'s own month', () => {
  // April 2026 starts on a Wednesday, so the grid leads with Mar 29-31.
  const april = Object.fromEntries(monthCells(2026, 3, new Date(2026, 3, 10)).map((c) => [c.iso, c]));
  assert.equal(april['2026-04-01'].isElapsed, true);
  assert.equal(april['2026-04-09'].isElapsed, true);
  assert.equal(april['2026-04-10'].isElapsed, false, 'today is not crossed off yet');
  assert.equal(april['2026-04-11'].isElapsed, false);
  assert.equal(april['2026-03-31'].isElapsed, false, 'past days of other months stay clean');

  // May 2026's grid leads with Apr 26-30; today's month still gets crossed off there.
  const may = Object.fromEntries(monthCells(2026, 4, new Date(2026, 3, 28)).map((c) => [c.iso, c]));
  assert.equal(may['2026-04-27'].isElapsed, true);
  assert.equal(may['2026-04-28'].isElapsed, false);
  assert.equal(may['2026-04-29'].isElapsed, false);
});

test('marksToDraw only animates notebook marks whose target changed', () => {
  const at = { fresh: false, monthKey: '2026-3', selected: '2026-04-10' };
  const all = { month: true, today: true, selection: true };
  assert.deepEqual(marksToDraw(null, at), all);
  assert.deepEqual(marksToDraw(at, at), { month: false, today: false, selection: false });
  assert.deepEqual(marksToDraw(at, { ...at, selected: '2026-04-11' }), { month: false, today: false, selection: true });
  assert.deepEqual(marksToDraw(at, { ...at, monthKey: '2026-4' }), all);
  assert.deepEqual(marksToDraw(at, { ...at, fresh: true }), all);
});

test('calendarAgendaKinds merges events, assignments and reminders under day headers', () => {
  const today = new Date(2026, 3, 10);
  const data = dataWith({
    calendar: [
      { title: 'Assembly', event_date: '2026-04-08', start_time: '09:00:00' },
      { title: 'Fair', event_date: '2026-04-10', start_time: '12:00:00' },
      { title: 'Far off', event_date: '2026-05-01' },
    ],
    assignments: [
      { id: 'undated', title: 'No due date', due_date: null },
      { id: 'essay', title: 'Essay', due_date: '2026-04-10' },
    ],
  });
  const reminders = [{ id: 'r1', title: 'Bring forms', date: '2026-04-12', note: null }];

  const rows = calendarAgendaKinds({ data, config: CONFIG, reminders, collapse: {}, today });
  assert.deepEqual(rows.map((r) => r.type), ['collapsible-header', 'now', 'header', 'item', 'item', 'header', 'item', 'header', 'item']);
  assert.deepEqual(rows[0], { type: 'collapsible-header', section: 'calendarPast', label: rows[0].label, count: 1, collapsed: true });
  assert.equal(rows[2].today, true);
  assert.deepEqual(
    rows.filter((r) => r.type === 'item').map((r) => [r.target.kind, r.target.index ?? r.target.reminder.id, r.soon]),
    [['assignment', 1, true], ['calendarEvent', 1, true], ['reminder', 'r1', true], ['calendarEvent', 2, false]],
    'sorted by day then time; the undated assignment keeps index 0 reserved; May is past this week',
  );
});

test('calendarAgendaKinds unfolds past days on request and honors calendarShowAssignments', () => {
  const today = new Date(2026, 3, 10);
  const data = dataWith({
    calendar: [{ title: 'Assembly', event_date: '2026-04-08', start_time: '09:00:00' }],
    assignments: [{ id: 'essay', title: 'Essay', due_date: '2026-04-11' }],
  });
  const open = calendarAgendaKinds({ data, config: CONFIG, reminders: [], collapse: { calendarPast: false }, today });
  assert.deepEqual(open.slice(0, 3).map((r) => r.type), ['collapsible-header', 'subheader', 'item']);
  assert.deepEqual(open[2], { type: 'item', target: { kind: 'calendarEvent', index: 0 }, past: true });

  const noAssignments = calendarAgendaKinds({ data, config: { calendarShowAssignments: false }, reminders: [], collapse: {}, today });
  assert.ok(noAssignments.every((r) => r.target?.kind !== 'assignment'));
  assert.deepEqual(noAssignments.slice(-2).map((r) => r.type), ['now', 'placeholder'], 'nothing upcoming once assignments are hidden');

  assert.deepEqual(calendarAgendaKinds({ data: dataWith(), config: CONFIG, reminders: [], today }), []);
});

