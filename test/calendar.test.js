import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toIsoDate, isoOf, monthCells, buildCalendarMonth, extractTime, marksToDraw, calendarAgendaKinds,
  eventColorToken, eventAudiences, eventClassIds, isEventTargetedAtMe, eventTargetingInfo, ownClassesAndGrade,
} from '../src/calendar.js';
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

test('monthCells uses only the complete weeks needed by the month', () => {
  const cells = monthCells(2026, 1, new Date(2026, 1, 10)); // Feb 2026
  assert.equal(cells.length, 28);
  assert.equal(monthCells(2026, 2).length, 35);
  assert.equal(monthCells(2026, 7).length, 42);
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
  assert.deepEqual(day12.items.map((i) => i.time), [null, '08:00', '14:00']);
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

test('eventColorToken maps known school colors to their CSS custom property, else null', () => {
  assert.equal(eventColorToken('teal'), '--event-color-teal');
  assert.equal(eventColorToken('amber'), '--event-color-amber');
  assert.equal(eventColorToken('magenta'), null, 'unknown color names fall back to no accent, not a guess');
  assert.equal(eventColorToken(null), null);
  assert.equal(eventColorToken(undefined), null);
});

test('eventAudiences prefers the audiences array over the audience scalar', () => {
  assert.deepEqual(eventAudiences({ audiences: ['everyone'], audience: 'staff' }), ['everyone']);
  assert.deepEqual(eventAudiences({ audiences: [], audience: 'everyone' }), ['everyone'], 'an empty array falls back to the scalar');
  assert.deepEqual(eventAudiences({ audiences: null, audience: 'everyone' }), ['everyone']);
  assert.deepEqual(eventAudiences({ audiences: null, audience: null }), []);
  assert.deepEqual(eventAudiences({}), []);
});

test('eventClassIds prefers the class_ids array over the class_id scalar', () => {
  assert.deepEqual(eventClassIds({ class_ids: ['c1', 'c2'], class_id: 'c3' }), ['c1', 'c2']);
  assert.deepEqual(eventClassIds({ class_ids: [], class_id: 'c3' }), ['c3'], 'an empty array falls back to the scalar');
  assert.deepEqual(eventClassIds({ class_ids: null, class_id: 'c3' }), ['c3']);
  assert.deepEqual(eventClassIds({ class_ids: null, class_id: null }), []);
  assert.deepEqual(eventClassIds({}), []);
});

test('isEventTargetedAtMe treats a fully untargeted event (every new field null) as everyone\'s', () => {
  const bare = { id: 'e1', title: 'Pep rally', event_date: '2026-02-12' };
  assert.equal(isEventTargetedAtMe(bare, ['c1'], 9), true);
  assert.equal(isEventTargetedAtMe(bare, [], null), true);
});

test('isEventTargetedAtMe matches explicit everyone, my class, my grade, and rejects the rest', () => {
  assert.equal(isEventTargetedAtMe({ audience: 'everyone' }, [], null), true);
  assert.equal(isEventTargetedAtMe({ audiences: ['everyone'] }, [], null), true);
  assert.equal(isEventTargetedAtMe({ class_id: 'c1' }, ['c1', 'c2'], null), true, 'class_id in userClassIds');
  assert.equal(isEventTargetedAtMe({ class_ids: ['c9', 'c1'] }, ['c1'], null), true, 'class_ids overlapping userClassIds');
  assert.equal(isEventTargetedAtMe({ class_id: 'c1' }, ['c2'], null), false, 'class_id not one of mine');
  assert.equal(isEventTargetedAtMe({ grade_level: 9 }, [], 9), true);
  assert.equal(isEventTargetedAtMe({ grade_level: 9 }, [], 10), false);
  assert.equal(isEventTargetedAtMe({ audience: 'staff' }, [], null), false, 'a real audience that is not "everyone" and matches nothing else');
});

test('eventTargetingInfo describes an event\'s audience, and is null when there is nothing to say', () => {
  assert.equal(eventTargetingInfo({}), null);
  assert.deepEqual(eventTargetingInfo({ audience: 'everyone' }), { kind: 'everyone' });
  assert.deepEqual(eventTargetingInfo({ class_id: 'c1' }, ['c1']), { kind: 'class', mine: true });
  assert.deepEqual(eventTargetingInfo({ class_id: 'c1' }, ['c2']), { kind: 'class', mine: false });
  assert.deepEqual(eventTargetingInfo({ grade_level: 9 }, [], 9), { kind: 'grade', grade: 9, mine: true });
  assert.deepEqual(eventTargetingInfo({ grade_level: 9 }, [], 10), { kind: 'grade', grade: 9, mine: false });
  assert.deepEqual(eventTargetingInfo({ audience: 'staff' }), { kind: 'other' });
});

test('ownClassesAndGrade reads the signed-in student\'s classes and grade level off enrollments', () => {
  const data = {
    enrollments: [
      { student_id: 's1', class_id: 'c1', students: { id: 's1', grade_level: 9 } },
      { student_id: 's1', class_id: 'c2', students: { id: 's1', grade_level: 9 } },
      { student_id: 's2', class_id: 'c3', students: { id: 's2', grade_level: 10 } },
    ],
  };
  assert.deepEqual(ownClassesAndGrade(data, 's1'), { classIds: ['c1', 'c2'], gradeLevel: 9 });
  assert.deepEqual(ownClassesAndGrade(data, 'nobody'), { classIds: [], gradeLevel: null });
  assert.deepEqual(ownClassesAndGrade({ enrollments: [] }, 's1'), { classIds: [], gradeLevel: null });
});

test('buildCalendarMonth is unaffected by the new calendar_events columns when they are all null', () => {
  const data = dataWith({
    calendar: [{ id: 'e1', title: 'Pep rally', event_date: '2026-02-12', color: null, audience: null, audiences: null, class_id: null, class_ids: null, grade_level: null }],
  });
  const grid = buildCalendarMonth({ year: 2026, month: 1, data, config: CONFIG, reminders: [], today: new Date(2026, 1, 1) });
  const day12 = grid.cells.find((c) => c.iso === '2026-02-12');
  assert.deepEqual(day12.items.map((i) => ({ kind: i.kind, title: i.title, time: i.time })), [{ kind: 'calendarEvent', title: 'Pep rally', time: null }]);
});

const ONLY_MINE = { calendarShowAssignments: true, calendarOnlyMine: true };
const VIEWER = { classIds: ['c-mine'], gradeLevel: 9 };

function eventsForFilterTests() {
  return [
    { id: 'e0', title: 'Other class only', event_date: '2026-09-10', audiences: ['class'], class_ids: ['c-theirs'] },
    { id: 'e1', title: 'Whole school', event_date: '2026-09-10', audiences: ['everyone'] },
    { id: 'e2', title: 'My class', event_date: '2026-09-10', audiences: ['class'], class_ids: ['c-mine'] },
    { id: 'e3', title: 'Grade 11', event_date: '2026-09-10', audiences: ['grade'], grade_level: 11 },
    { id: 'e4', title: 'My grade', event_date: '2026-09-10', audiences: ['grade'], grade_level: 9 },
  ];
}

function septemberItems(config, viewer) {
  const grid = buildCalendarMonth({ year: 2026, month: 8, data: dataWith({ calendar: eventsForFilterTests() }), config, viewer, reminders: [], today: new Date(2026, 8, 10) });
  return grid.cells.find((c) => c.iso === '2026-09-10').items;
}

test('calendarOnlyMine keeps events aimed at everyone, my class or my grade', () => {
  const titles = septemberItems(ONLY_MINE, VIEWER).map((i) => i.title);
  assert.deepEqual(titles, ['Whole school', 'My class', 'My grade']);
});

test('calendarOnlyMine off shows every event', () => {
  assert.equal(septemberItems(CONFIG, VIEWER).length, 5);
});

test('filtered calendar items keep their original state.data index, so detail targets stay correct', () => {
  const items = septemberItems(ONLY_MINE, VIEWER);
  const source = eventsForFilterTests();
  for (const item of items) {
    assert.equal(source[item.index].title, item.title, `index ${item.index} must still point at "${item.title}"`);
  }
  assert.deepEqual(items.map((i) => i.index), [1, 2, 4], 'the skipped events must not close the gaps');
});

test('calendarOnlyMine without a viewer filters nothing rather than hiding everything', () => {
  assert.equal(septemberItems(ONLY_MINE, null).length, 5);
});

test('calendarAgendaKinds honours calendarOnlyMine too', () => {
  const data = dataWith({ calendar: eventsForFilterTests() });
  const all = calendarAgendaKinds({ data, config: CONFIG, viewer: VIEWER, reminders: [], today: new Date(2026, 8, 10) });
  const mine = calendarAgendaKinds({ data, config: ONLY_MINE, viewer: VIEWER, reminders: [], today: new Date(2026, 8, 10) });
  const countItems = (rows) => rows.filter((r) => r.type === 'item').length;
  assert.equal(countItems(all), 5);
  assert.equal(countItems(mine), 3);
});

