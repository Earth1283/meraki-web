import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rowKinds, detailFields, moodLabels, tabs, TAB_IDS, daysUntil, overviewSummary, fieldDisplay,
  classSections, submissionForAssignment, submissionForAssessment, formatBytes, formatDateTime,
  messageThreads, partnerName, initials, dayKey, formatDaySeparator, formatTime12,
  orderedTabIds, visibleTabs,
} from '../src/rows.js';
import { i18nReady } from '../src/i18n.js';

// rows.js's labels/titles now go through i18n's t(), which loads its
// dictionaries asynchronously (fetch in the browser, fs in plain Node —
// see i18n.js) — wait for that once so every test below sees real English
// strings instead of raw translation keys.
await i18nReady;

const FIXED_TODAY = new Date('2026-09-10T12:00:00');

function emptyData(overrides = {}) {
  return {
    classes: [], assignments: [], grades: [], attendance: [], calendar: [],
    announcements: [], messages: [], portfolio: [], checkins: [],
    hero: null, behaviorNotes: [], detentions: [], reportCards: [],
    assessments: [], discussions: [], fileUploads: [], enrollments: [],
    assignmentSubmissions: [], assessmentSubmissions: [],
    standards: [], assignmentStandards: [], loginEvents: [], activity: [],
    ...overrides,
  };
}

test('daysUntil counts whole days relative to the given today, ignoring time-of-day', () => {
  assert.equal(daysUntil('2026-09-10', FIXED_TODAY), 0);
  assert.equal(daysUntil('2026-09-17', FIXED_TODAY), 7);
  assert.equal(daysUntil('2026-09-09', FIXED_TODAY), -1);
  assert.equal(daysUntil(null, FIXED_TODAY), null);
});

test('overviewSummary buckets assignments into this-week vs overdue-and-ungraded', () => {
  const data = emptyData({
    assignments: [
      { id: 'a1', due_date: '2026-09-10' }, // today -> this week
      { id: 'a2', due_date: '2026-09-16' }, // +6 days -> this week
      { id: 'a3', due_date: '2026-09-17' }, // +7 days -> not this week
      { id: 'a4', due_date: '2026-09-01' }, // past, no grade -> overdue
      { id: 'a5', due_date: '2026-09-01' }, // past, graded -> not overdue
      { id: 'a6', due_date: null }, // no due date -> ignored
    ],
    grades: [{ id: 'g1', assignment_id: 'a5', points_earned: 10 }],
  });
  const summary = overviewSummary(data, FIXED_TODAY);
  assert.deepEqual(summary.dueThisWeek, [0, 1]);
  assert.deepEqual(summary.overdueUngraded, [3]);
});

test('overviewSummary.dueThisWeekTasks combines assignments and assessments due this week, each tagged with completion', () => {
  const data = emptyData({
    assignments: [
      { id: 'a1', due_date: '2026-09-10' }, // today, no submission -> todo
      { id: 'a2', due_date: '2026-10-01' }, // outside window -> excluded
    ],
    assessments: [
      { id: 'q1', due_at: '2026-09-12T15:00:00+00:00' }, // this week, submitted -> done
      { id: 'q2', due_at: '2026-09-20T15:00:00+00:00' }, // outside window -> excluded
    ],
    assignmentSubmissions: [],
    assessmentSubmissions: [{ id: 's1', assessments: { class_id: undefined, title: undefined } }],
  });
  // submissionForAssessment matches on (class_id, title) pairs, both undefined here on
  // both sides, which is enough to exercise "a submission exists" without real assessments data.
  const summary = overviewSummary(data, FIXED_TODAY);
  assert.deepEqual(
    summary.dueThisWeekTasks.map((t) => [t.kind, t.index, t.done]),
    [
      ['assignment', 0, false],
      ['assessment', 0, true],
    ],
  );
});

test('overviewSummary.dueThisWeekTasks drops the assignment duplicate when an assessment backs it (same quiz, two rows)', () => {
  const data = emptyData({
    assignments: [
      { id: 'a1', due_date: '2026-09-10' }, // backs q1 -> should not appear on its own
      { id: 'a2', due_date: '2026-09-11' }, // plain assignment, no assessment -> appears
    ],
    assessments: [{ id: 'q1', assignment_id: 'a1', due_at: '2026-09-10T15:00:00+00:00' }],
    assignmentSubmissions: [],
    assessmentSubmissions: [],
  });
  const summary = overviewSummary(data, FIXED_TODAY);
  assert.deepEqual(
    summary.dueThisWeekTasks.map((t) => [t.kind, t.index]),
    [
      ['assessment', 0],
      ['assignment', 1],
    ],
  );
  // The stat tile's plain assignment count is intentionally untouched by
  // the dedup — it still counts every assignment due, backing or not.
  assert.deepEqual(summary.dueThisWeek, [0, 1]);
});

test('overviewSummary reports unread messages, and no attendance today as an explicit null', () => {
  const data = emptyData({
    messages: [{ id: 'm1', read: false }, { id: 'm2', read: true }, { id: 'm3', read: false }],
  });
  const summary = overviewSummary(data, FIXED_TODAY);
  assert.equal(summary.unreadCount, 2);
  assert.equal(summary.attendanceToday, null);
});

test("overviewSummary finds today's attendance record", () => {
  const data = emptyData({
    attendance: [
      { id: 'r1', date: '2026-09-09', status: 'present' },
      { id: 'r2', date: '2026-09-10', status: 'tardy' },
    ],
  });
  const summary = overviewSummary(data, FIXED_TODAY);
  assert.equal(summary.attendanceToday.status, 'tardy');
});

test('overview rowKinds shows an empty-state placeholder instead of a bare empty section', () => {
  const kinds = rowKinds('overview', emptyData(), FIXED_TODAY);
  const placeholders = kinds.filter((k) => k.type === 'placeholder');
  assert.equal(placeholders.length, 2);
  assert.match(placeholders[0].text, /caught up/);
  assert.match(placeholders[1].text, /No announcements/);
});

test('overview rowKinds lists only assignments due within the next 7 days', () => {
  const data = emptyData({
    assignments: [
      { id: 'a1', title: 'This week', due_date: '2026-09-12' },
      { id: 'a2', title: 'Next month', due_date: '2026-10-01' },
      { id: 'a3', title: 'No due date', due_date: null },
    ],
  });
  const kinds = rowKinds('overview', data, FIXED_TODAY);
  const items = kinds.filter((k) => k.type === 'item' && k.target.kind === 'assignment');
  assert.equal(items.length, 1);
  assert.equal(items[0].target.index, 0);
});

test('overview rowKinds defaults To Be Done open and Done collapsed, and hides an empty Done section entirely', () => {
  const data = emptyData({
    assignments: [
      { id: 'a1', title: 'Not done', due_date: '2026-09-12' },
      { id: 'a2', title: 'Done', due_date: '2026-09-13' },
    ],
    assignmentSubmissions: [{ id: 'sub1', assignment_id: 'a2', submitted_at: '2026-09-11T00:00:00Z', status: 'submitted' }],
  });
  const kinds = rowKinds('overview', data, FIXED_TODAY);
  const headers = kinds.filter((k) => k.type === 'collapsible-header');
  assert.deepEqual(headers.map((h) => [h.section, h.count, h.collapsed]), [
    ['todo', 1, false],
    ['done', 1, true],
  ]);
  // Done is collapsed by default, so no done item row should be present yet.
  assert.equal(kinds.some((k) => k.type === 'item' && k.done), false);
  assert.equal(kinds.some((k) => k.type === 'item' && k.target.index === 0 && !k.done), true);
});

test('overview rowKinds omits the Done header entirely when nothing is done yet', () => {
  const data = emptyData({ assignments: [{ id: 'a1', title: 'Pending', due_date: '2026-09-12' }] });
  const kinds = rowKinds('overview', data, FIXED_TODAY);
  assert.equal(kinds.some((k) => k.type === 'collapsible-header' && k.section === 'done'), false);
});

test('overview rowKinds respects an explicit collapse override, e.g. expanding Done', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', title: 'Done', due_date: '2026-09-12' }],
    assignmentSubmissions: [{ id: 'sub1', assignment_id: 'a1', submitted_at: '2026-09-11T00:00:00Z', status: 'submitted' }],
  });
  const kinds = rowKinds('overview', data, FIXED_TODAY, { done: false });
  const doneItems = kinds.filter((k) => k.type === 'item' && k.done);
  assert.equal(doneItems.length, 1);
});

test('fieldDisplay renders "No data" for null, undefined, and empty string only', () => {
  assert.equal(fieldDisplay(null), 'No data');
  assert.equal(fieldDisplay(undefined), 'No data');
  assert.equal(fieldDisplay(''), 'No data');
  assert.equal(fieldDisplay(0), '0');
  assert.equal(fieldDisplay('Room 204'), 'Room 204');
});

test('detailFields leaves blank optional fields as null/undefined rather than inventing placeholder text', () => {
  const data = emptyData({
    classes: [{ id: 'c1', name: 'Study Hall', subject: null, period: null, room: null, term: null, teacher_name: null }],
  });
  const { fields } = detailFields({ kind: 'class', index: 0 }, data);
  for (const [, value] of fields) {
    assert.ok(value === null || value === undefined, `expected blank field value, got ${JSON.stringify(value)}`);
  }
});

test('me tab shows placeholders for empty portfolio and checkins, no info row without a hero', () => {
  const kinds = rowKinds('me', emptyData());
  assert.equal(kinds.some((k) => k.type === 'info'), false);
  const placeholders = kinds.filter((k) => k.type === 'placeholder');
  assert.equal(placeholders.length, 2);
});

test('me tab adds a discreet Meraki-side error hint only when check-ins cannot load', () => {
  const normal = rowKinds('me', emptyData()).find((k) => k.type === 'header' && k.label === 'Check-ins');
  const unavailable = rowKinds('me', emptyData({ checkinsUnavailable: true })).find((k) => k.type === 'header' && k.label === 'Check-ins');
  assert.equal(normal.hint, null);
  assert.match(unavailable.hint, /not a problem with this app/i);
});

test('me tab shows the info row once a hero profile exists', () => {
  const kinds = rowKinds('me', emptyData({ hero: { hero_class: 'wizard' } }));
  assert.equal(kinds[0].type, 'info');
});

test('myrecord lists every record type independently', () => {
  const data = emptyData({
    behaviorNotes: [{ id: '1' }],
    detentions: [],
    reportCards: [{ id: '1' }, { id: '2' }],
  });
  const kinds = rowKinds('myrecord', data);
  const behaviorItems = kinds.filter((k) => k.type === 'item' && k.target.kind === 'behaviorNote');
  const detentionPlaceholders = kinds.filter((k) => k.type === 'placeholder' && k.text.includes('none on file'));
  const reportItems = kinds.filter((k) => k.type === 'item' && k.target.kind === 'reportCard');
  assert.equal(behaviorItems.length, 1);
  assert.equal(detentionPlaceholders.length, 1);
  assert.equal(reportItems.length, 2);
});

test('privacy tab has no navigable rows', () => {
  assert.deepEqual(rowKinds('privacy', emptyData()), []);
});

test('detailFields surfaces the joined assignment on a grade', () => {
  const data = emptyData({
    grades: [{ id: 'g1', points_earned: 45, assignments: { title: 'Essay', points_possible: 50, due_date: '2026-02-01' } }],
  });
  const { title, fields } = detailFields({ kind: 'grade', index: 0 }, data);
  assert.equal(title, 'Essay');
  assert.deepEqual(fields.find(([label]) => label === 'Score'), ['Score', '45/50']);
});

test('detailFields falls back to class lookup when an assignment has no joined class name', () => {
  const data = emptyData({
    classes: [{ id: 'c1', name: 'Algebra II' }],
    assignments: [{ id: 'a1', title: 'Homework', class_id: 'c1', classes: null }],
  });
  const { fields } = detailFields({ kind: 'assignment', index: 0 }, data);
  assert.deepEqual(fields.find(([label]) => label === 'Class'), ['Class', 'Algebra II']);
});

test('moodLabels() is ordered worst to best and 1-indexed by mood value', () => {
  const labels = moodLabels();
  assert.equal(labels[0], 'Rough');
  assert.equal(labels[labels.length - 1], 'Great');
});

test('classSections scopes every table to just the requested class_id', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', class_id: 'c1' }, { id: 'a2', class_id: 'c2' }],
    assessments: [{ id: 'q1', class_id: 'c1' }],
    discussions: [{ id: 'd1', class_id: 'c2' }],
    fileUploads: [{ id: 'f1', class_id: 'c1' }, { id: 'f2', class_id: 'c1' }],
    enrollments: [{ id: 'e1', class_id: 'c1' }, { id: 'e2', class_id: 'c2' }],
  });
  const s = classSections(data, 'c1');
  assert.deepEqual(s.assignments, [0]);
  assert.deepEqual(s.assessments, [0]);
  assert.deepEqual(s.discussions, []);
  assert.deepEqual(s.files, [0, 1]);
  assert.deepEqual(s.roster, [0]);
});

test('submissionForAssignment matches by assignment_id', () => {
  const data = emptyData({
    assignmentSubmissions: [{ id: 's1', assignment_id: 'a1', status: 'on_time' }],
  });
  assert.equal(submissionForAssignment(data, 'a1')?.status, 'on_time');
  assert.equal(submissionForAssignment(data, 'nope'), null);
});

test('submissionForAssessment matches on the embedded class_id + title pair', () => {
  const data = emptyData({
    assessmentSubmissions: [
      { id: 's1', manual_score: 18, total_points: 20, assessments: { title: 'Unit Quiz', class_id: 'c1' } },
      { id: 's2', manual_score: 5, total_points: 20, assessments: { title: 'Unit Quiz', class_id: 'c2' } },
    ],
  });
  const match = submissionForAssessment(data, { title: 'Unit Quiz', class_id: 'c1' });
  assert.equal(match.manual_score, 18);
  assert.equal(submissionForAssessment(data, { title: 'Other Quiz', class_id: 'c1' }), null);
});

test('formatBytes scales through B/KB/MB', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(null), null);
});

test('formatDateTime uses the selected locale and local time zone', () => {
  const iso = '2026-09-06T03:01:29.437Z';
  const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  assert.equal(formatDateTime(iso), expected);
  assert.equal(formatDateTime(null), null);
});

test('detailFields for a class lists its own attributes, leaving sub-sections to classSections', () => {
  const data = emptyData({
    classes: [{ id: 'c1', name: 'AP Biology', subject: 'Science', period: '3', room: '204', term: 'Fall', teacher_name: 'Dr. Alvarez' }],
  });
  const { title, fields } = detailFields({ kind: 'class', index: 0 }, data);
  const populated = fields.filter(([, value]) => value != null).map(([, value]) => value);
  assert.equal(title, 'AP Biology');
  assert.deepEqual(populated, ['Science', '3', '204', 'Fall', 'Dr. Alvarez']);
});

test('detailFields for a class carries grade level and the class timezone when the school sets them', () => {
  const data = emptyData({
    classes: [{ id: 'c1', name: 'AP Biology', grade_level: 9, timezone: 'Asia/Shanghai' }],
  });
  const { fields } = detailFields({ kind: 'class', index: 0 }, data);
  const populated = fields.filter(([, value]) => value != null).map(([, value]) => value);
  assert.deepEqual(populated, [9, 'Asia/Shanghai']);
});

test('detailFields for an assignment includes submission status when one exists', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', title: 'Essay', submission_mode: 'online_upload' }],
    assignmentSubmissions: [{ id: 's1', assignment_id: 'a1', status: 'late', submitted_at: '2026-09-05T10:00:00Z' }],
  });
  const { fields } = detailFields({ kind: 'assignment', index: 0 }, data);
  assert.deepEqual(fields.find(([label]) => label === 'Submission status'), ['Submission status', 'Late']);
  assert.deepEqual(fields.find(([label]) => label === 'Submission mode'), ['Submission mode', 'Online Upload']);
});

test('detailFields for an assessment resolves its score via submissionForAssessment', () => {
  const data = emptyData({
    assessments: [{ id: 'q1', title: 'Unit Quiz', class_id: 'c1', kind: 'quiz' }],
    assessmentSubmissions: [{ id: 's1', manual_score: 18, auto_score: null, total_points: 20, assessments: { title: 'Unit Quiz', class_id: 'c1' } }],
  });
  const { fields } = detailFields({ kind: 'assessment', index: 0 }, data);
  assert.deepEqual(fields.find(([label]) => label === 'Your score'), ['Your score', '18/20']);
});

test('detailFields for a fileUpload surfaces file metadata for the download button', () => {
  const data = emptyData({
    fileUploads: [{ id: 'f1', title: 'Syllabus', file_name: 'syllabus.pdf', mime_type: 'application/pdf', size_bytes: 10240, class_id: 'c1' }],
  });
  const { fields } = detailFields({ kind: 'fileUpload', index: 0 }, data);
  assert.deepEqual(fields.find(([label]) => label === 'Size'), ['Size', '10 KB']);
});

test('messageThreads groups a flat inbox into one thread per counterparty', () => {
  const data = emptyData({
    messages: [
      { id: 'm1', sender_id: 't1', recipient_id: 'me', created_at: '2026-09-01T10:00:00Z', read: true },
      { id: 'm2', sender_id: 'me', recipient_id: 't1', created_at: '2026-09-02T10:00:00Z', read: true },
      { id: 'm3', sender_id: 't2', recipient_id: 'me', created_at: '2026-09-03T10:00:00Z', read: false },
    ],
  });
  const threads = messageThreads(data, 'me');
  assert.equal(threads.length, 2);
  // most recently active thread first
  assert.equal(threads[0].partnerId, 't2');
  assert.equal(threads[0].unread, true);
  assert.equal(threads[1].partnerId, 't1');
  assert.equal(threads[1].indices.length, 2);
});

test('messageThreads sorts each thread chronologically regardless of fetch order', () => {
  const data = emptyData({
    messages: [
      { id: 'm2', sender_id: 'me', recipient_id: 't1', created_at: '2026-09-02T10:00:00Z', read: true },
      { id: 'm1', sender_id: 't1', recipient_id: 'me', created_at: '2026-09-01T10:00:00Z', read: true },
    ],
  });
  const [thread] = messageThreads(data, 'me');
  const orderedIds = thread.indices.map((i) => data.messages[i].id);
  assert.deepEqual(orderedIds, ['m1', 'm2']);
});

test('partnerName resolves a teacher via their class, falls back for unknowns, and special-cases self', () => {
  const data = emptyData({ classes: [{ id: 'c1', teacher_id: 't1', teacher_name: 'Dr. Alvarez' }] });
  assert.equal(partnerName(data, 'me', 'me'), 'Myself');
  assert.equal(partnerName(data, 'me', 't1'), 'Dr. Alvarez');
  assert.equal(partnerName(data, 'me', 'ghost'), 'Unknown');
});

test('initials abbreviates first+last, or the first two letters of a single word', () => {
  assert.equal(initials('Dr. Alvarez'), 'DA');
  assert.equal(initials('Myself'), 'MY');
  assert.equal(initials(''), '?');
});

test('dayKey groups by local calendar day regardless of the UTC hour', () => {
  // 11pm US-Pacific is already the next day in UTC — dayKey must not drift
  // with it, same lesson as the earlier Overview timezone bug.
  assert.equal(dayKey('2026-09-06T23:30:00-08:00'), dayKey('2026-09-06T08:00:00-08:00'));
});

test('formatDaySeparator special-cases today and yesterday, otherwise a full date', () => {
  const today = new Date('2026-09-10T12:00:00');
  assert.equal(formatDaySeparator('2026-09-10T08:00:00', today), 'Today');
  assert.equal(formatDaySeparator('2026-09-09T08:00:00', today), 'Yesterday');
  assert.equal(formatDaySeparator('2026-09-01T08:00:00', today), 'September 1, 2026');
});

test('formatTime12 renders 12-hour time with AM/PM, including the noon/midnight edge cases', () => {
  assert.equal(formatTime12('2026-09-06T17:15:00'), '5:15 PM');
  assert.equal(formatTime12('2026-09-06T00:05:00'), '12:05 AM');
  assert.equal(formatTime12('2026-09-06T12:00:00'), '12:00 PM');
  assert.equal(formatTime12(null), '');
});

test('formatTime12 switches to 24-hour time when asked', () => {
  assert.equal(formatTime12('2026-09-06T17:15:00', true), '17:15');
  assert.equal(formatTime12('2026-09-06T00:05:00', true), '00:05');
  assert.equal(formatTime12(null, true), '');
});

test('orderedTabIds appends tabs missing from a stored order instead of dropping them', () => {
  const knownIds = TAB_IDS;
  const partial = knownIds.slice(0, 3);
  const result = orderedTabIds({ tabOrder: partial });
  assert.deepEqual(result.slice(0, 3), partial);
  assert.equal(result.length, knownIds.length);
  assert.deepEqual([...result].sort(), [...knownIds].sort());
});

test('orderedTabIds ignores unknown ids left over from a removed tab', () => {
  const result = orderedTabIds({ tabOrder: ['ghost-tab', ...TAB_IDS] });
  assert.ok(!result.includes('ghost-tab'));
  assert.equal(result.length, TAB_IDS.length);
});

test('visibleTabs filters out hidden tabs but preserves the configured order', () => {
  const ids = TAB_IDS;
  const [first, second, third] = ids;
  const rest = ids.slice(3);
  const result = visibleTabs({ tabOrder: [third, first, second, ...rest], hiddenTabs: [second] });
  assert.deepEqual(result.map((t) => t.id), [third, first, ...rest]);
});

test('detailFields for an assignment shows your score once it is graded', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', title: 'Essay', points_possible: 10 }],
    grades: [{ id: 'g1', assignment_id: 'a1', points_earned: 9 }],
  });
  const { fields } = detailFields({ kind: 'assignment', index: 0 }, data);
  assert.deepEqual(fields.find(([label]) => label === 'Your score'), ['Your score', '9/10']);
});

test('detailFields shows the mark in place of a score for a grade scored with one', () => {
  const data = emptyData({
    assignments: [{ id: 'a1', title: 'Quiz', points_possible: 10 }],
    grades: [{ id: 'g1', assignment_id: 'a1', points_earned: null, comment: 'MARK:EX', assignments: { title: 'Quiz', points_possible: 10 } }],
  });
  assert.deepEqual(detailFields({ kind: 'assignment', index: 0 }, data).fields.find(([label]) => label === 'Your score'), ['Your score', 'Mark EX']);
  assert.deepEqual(detailFields({ kind: 'grade', index: 0 }, data).fields.find(([label]) => label === 'Score'), ['Score', 'Mark EX']);
});

function labelled(fields) {
  return Object.fromEntries(fields.filter(([, value]) => value != null));
}

test('detailFields for a behavior note surfaces the reason, the work it is tied to, and a zeroed grade', async () => {
  const data = emptyData({
    behaviorNotes: [{ id: 'b1', kind: 'missing_work', date: '2026-09-06', reason: 'Not turned in', notes: 'Third time this term', scored_zero: true, assignment_id: 'a1', assignments: { title: 'Harrison Bergeron' } }],
  });
  const { fields, body } = detailFields({ kind: 'behaviorNote', index: 0 }, data);
  const shown = labelled(fields);
  assert.equal(shown['Reason'], 'Not turned in');
  assert.equal(shown['Linked work'], 'Harrison Bergeron');
  assert.equal(shown['Scored zero'], 'Yes');
  assert.equal(body, 'Third time this term');
});

test('detailFields leaves scored zero off a note that did not zero the grade', () => {
  const data = emptyData({ behaviorNotes: [{ id: 'b1', kind: 'positive', date: '2026-09-06', scored_zero: false }] });
  const shown = labelled(detailFields({ kind: 'behaviorNote', index: 0 }, data).fields);
  assert.equal('Scored zero' in shown, false);
  assert.equal('Linked work' in shown, false);
});

test('detailFields for a detention shows when it was issued and who was contacted', () => {
  const data = emptyData({
    detentions: [{ id: 'd1', scheduled_date: '2026-09-12', status: 'scheduled', strike_count: 3, reason: 'Third strike', created_at: '2026-09-06T03:01:29.437Z', students: { guardian_email: 'parent@example.com' } }],
  });
  const shown = labelled(detailFields({ kind: 'detention', index: 0 }, data).fields);
  assert.equal(shown['Guardian contact'], 'parent@example.com');
  assert.equal(shown['Issued'], formatDateTime('2026-09-06T03:01:29.437Z'));
});

test('detailFields for an announcement names its audience only when the school set one', () => {
  const withAudience = emptyData({ announcements: [{ id: 'n1', title: 'Snow day', created_at: '2026-09-06T03:01:29.437Z', audience: 'everyone' }] });
  assert.equal(labelled(detailFields({ kind: 'announcement', index: 0 }, withAudience).fields)['Audience'], 'Everyone');
  const without = emptyData({ announcements: [{ id: 'n1', title: 'Snow day', created_at: '2026-09-06T03:01:29.437Z', audience: null }] });
  assert.equal('Audience' in labelled(detailFields({ kind: 'announcement', index: 0 }, without).fields), false);
});

test('detailFields for an attendance record names the class it was taken in', () => {
  const data = emptyData({
    classes: [{ id: 'c1', name: 'AP Biology' }],
    attendance: [{ id: 'r1', date: '2026-09-06', status: 'present', class_id: 'c1' }],
  });
  assert.equal(labelled(detailFields({ kind: 'attendance', index: 0 }, data).fields)['Class'], 'AP Biology');
});

test('detailFields flags an assignment that has a rubric attached', () => {
  const withRubric = emptyData({ assignments: [{ id: 'a1', title: 'Essay', rubric_id: 'r1' }] });
  assert.equal(labelled(detailFields({ kind: 'assignment', index: 0 }, withRubric).fields)['Rubric'], 'Attached');
  const without = emptyData({ assignments: [{ id: 'a1', title: 'Essay', rubric_id: null }] });
  assert.equal('Rubric' in labelled(detailFields({ kind: 'assignment', index: 0 }, without).fields), false);
});
