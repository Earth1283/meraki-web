import { el, svgIcon } from './dom.js';
import { t } from './i18n.js';
import { iconPaths } from './icons.js';
import { seededRandom, sketchCircle, sketchSpiral, sketchStar, sketchSvg, sketchTallyGroup, tallyGroups } from './sketch.js';

// Mood/tab labels are looked up live (functions, not module-eval constants)
// so every call site re-reads them under the current locale on each render.
export function moodLabels() {
  return [t('mood.1'), t('mood.2'), t('mood.3'), t('mood.4'), t('mood.5')];
}

export const TAB_IDS = ['overview', 'classes', 'grades', 'analytics', 'assignments', 'attendance', 'calendar', 'announcements', 'messages', 'me', 'myrecord', 'privacy'];

export function tabs() {
  return TAB_IDS.map((id) => ({ id, title: t(`tab.${id}`) }));
}

export function tabTitle(id) {
  return t(`tab.${id}`) ?? id;
}

export function commandLabels() {
  return [...tabs().map((tb) => t('palette.goto', { name: tb.title })), t('palette.refresh'), t('palette.settings'), t('palette.logout')];
}

/** All known tab ids, arranged per config.tabOrder — any id missing from a
 * stored order (new tabs shipped after the config was saved) is appended at
 * the end, so a saved order never silently hides a tab that didn't exist
 * yet when it was written. */
export function orderedTabIds(config) {
  const known = new Set(TAB_IDS);
  const stored = (config.tabOrder || []).filter((id) => known.has(id));
  const missing = TAB_IDS.filter((id) => !stored.includes(id));
  return [...stored, ...missing];
}

export function orderedTabs(config) {
  const all = tabs();
  return orderedTabIds(config).map((id) => all.find((tb) => tb.id === id));
}

/** The sidebar's nav list: ordered tabs with the hidden ones filtered out.
 * Hidden tabs are still reachable via the command palette — hiding is about
 * decluttering the sidebar, not blocking navigation. */
export function visibleTabs(config) {
  const hidden = new Set(config.hiddenTabs || []);
  return orderedTabs(config).filter((t) => !hidden.has(t.id));
}

export function filterLabels(labels, query) {
  const q = query.toLowerCase();
  return labels.filter((l) => l.toLowerCase().includes(q));
}

export function rowKinds(tabId, data, today = new Date(), overviewCollapse = {}) {
  const rows = [];
  switch (tabId) {
    case 'overview': {
      const { todo: todoCollapsed = false, done: doneCollapsed = true } = overviewCollapse;
      const { dueThisWeekTasks } = overviewSummary(data, today);
      const todo = dueThisWeekTasks.filter((t) => !t.done);
      const done = dueThisWeekTasks.filter((t) => t.done);

      rows.push({ type: 'collapsible-header', section: 'todo', label: t('overview.todo'), count: todo.length, collapsed: todoCollapsed });
      if (!todoCollapsed) {
        if (todo.length === 0) {
          rows.push({ type: 'placeholder', tone: 'good', text: t('overview.caughtUp') });
        } else {
          todo.forEach((t) => rows.push({ type: 'item', target: { kind: t.kind, index: t.index } }));
        }
      }
      // Only shown once something's actually done — an empty "Done" section
      // collapsed by default would just be a header that never earns its
      // place on screen.
      if (done.length > 0) {
        rows.push({ type: 'collapsible-header', section: 'done', label: t('overview.done'), count: done.length, collapsed: doneCollapsed });
        if (!doneCollapsed) {
          done.forEach((t) => rows.push({ type: 'item', target: { kind: t.kind, index: t.index }, done: true }));
        }
      }
      rows.push({ type: 'header', label: t('overview.recentAnnouncements') });
      const recent = data.announcements.slice(0, 5);
      if (recent.length === 0) {
        rows.push({ type: 'placeholder', text: t('overview.noAnnouncements') });
      } else {
        recent.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'announcement', index: i } }));
      }
      break;
    }
    case 'classes':
      data.classes.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'class', index: i } }));
      break;
    case 'grades':
      data.grades.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'grade', index: i } }));
      break;
    case 'assignments':
      data.assignments.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'assignment', index: i } }));
      break;
    case 'attendance':
      data.attendance.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'attendance', index: i } }));
      break;
    case 'calendar':
      data.calendar.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'calendarEvent', index: i } }));
      break;
    case 'announcements':
      data.announcements.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'announcement', index: i } }));
      break;
    case 'messages':
      data.messages.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'message', index: i } }));
      break;
    case 'me': {
      if (data.hero) rows.push({ type: 'info' });
      rows.push({ type: 'header', label: t('me.portfolio') });
      if (data.portfolio.length === 0) rows.push({ type: 'placeholder', text: t('none.yet') });
      else data.portfolio.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'portfolio', index: i } }));
      rows.push({ type: 'header', label: t('me.checkins') });
      if (data.checkins.length === 0) rows.push({ type: 'placeholder', text: t('none.yet') });
      else data.checkins.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'checkin', index: i } }));
      break;
    }
    case 'myrecord': {
      rows.push({ type: 'header', label: t('record.behaviorNotes') });
      if (data.behaviorNotes.length === 0) rows.push({ type: 'placeholder', text: t('none.onFile') });
      else data.behaviorNotes.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'behaviorNote', index: i } }));
      rows.push({ type: 'header', label: t('record.detentions') });
      if (data.detentions.length === 0) rows.push({ type: 'placeholder', text: t('none.onFile') });
      else data.detentions.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'detention', index: i } }));
      rows.push({ type: 'header', label: t('record.reportCards') });
      if (data.reportCards.length === 0) rows.push({ type: 'placeholder', text: t('none.published') });
      else data.reportCards.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'reportCard', index: i } }));
      break;
    }
    case 'privacy':
      break;
    // Analytics has no flat item list — it's rendered as class cards by
    // analytics.js, wired in specially by main.js the same way 'privacy' is.
    case 'analytics':
      break;
  }
  return rows;
}

export function pctClass(pct) {
  if (pct == null) return 'dim';
  if (pct >= 90) return 'good';
  if (pct >= 70) return 'warn';
  return 'bad';
}

export function statusClass(status) {
  if (status === 'present') return 'good';
  if (status === 'absent') return 'bad';
  if (status === 'tardy' || status === 'late') return 'warn';
  return 'dim';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Deliberately not toISOString(): that converts to UTC, which shifts the
// calendar date for anyone not at UTC+0 (e.g. local midnight in UTC+8 is
// still the previous day in UTC) and would silently miss "today"'s
// attendance record for most of the world.
function localDateStr(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysUntil(dateStr, today = new Date()) {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  return Math.round((d - startOfDay(today)) / 86400000);
}

/**
 * A snapshot of what actually needs attention right now, not just "every
 * assignment that has a due date" — that's what makes Overview a dashboard
 * instead of a second copy of the Assignments tab.
 */
export function overviewSummary(data, today = new Date()) {
  const todayStr = localDateStr(today);
  const gradedAssignmentIds = new Set(data.grades.map((g) => g.assignment_id).filter(Boolean));

  const dueThisWeek = [];
  // Assignments and assessments both belong in "what's due" — dueThisWeek
  // (assignments-only indices) stays as-is for the overview stat tile, but
  // the Overview list itself needs both kinds together with a completion
  // flag, hence this separate combined list.
  const dueThisWeekTasks = [];
  // A quiz/test's assessment row and its backing gradebook assignment row
  // describe the same real-world task — without this, both show up as
  // separate "due this week" entries. The assessment row wins (it carries
  // the quiz-specific completion status and the per-question breakdown),
  // so its backing assignment is skipped here.
  const backingAssignmentIds = new Set(data.assessments.map((a) => a.assignment_id).filter(Boolean));
  const overdueUngraded = [];
  data.assignments.forEach((a, i) => {
    const delta = daysUntil(a.due_date, today);
    if (delta == null) return;
    if (delta >= 0 && delta <= 6) {
      dueThisWeek.push(i);
      if (!backingAssignmentIds.has(a.id)) {
        dueThisWeekTasks.push({ kind: 'assignment', index: i, dueDate: a.due_date, done: !!submissionForAssignment(data, a.id) });
      }
    } else if (delta < 0 && !gradedAssignmentIds.has(a.id)) overdueUngraded.push(i);
  });
  data.assessments.forEach((a, i) => {
    // due_at is a full timestamp; daysUntil wants a bare date.
    const delta = daysUntil(a.due_at ? a.due_at.slice(0, 10) : null, today);
    if (delta == null || delta < 0 || delta > 6) return;
    dueThisWeekTasks.push({ kind: 'assessment', index: i, dueDate: a.due_at, done: !!submissionForAssessment(data, a) });
  });
  dueThisWeekTasks.sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? ''));

  const unreadCount = data.messages.filter((m) => m.read === false).length;
  const attendanceToday = data.attendance.find((r) => r.date === todayStr) ?? null;

  const gradedPcts = data.grades
    .map((g) => {
      const possible = g.assignments?.points_possible;
      return g.points_earned != null && possible ? (g.points_earned / possible) * 100 : null;
    })
    .filter((p) => p != null);
  const avgGradePct = gradedPcts.length ? gradedPcts.reduce((sum, p) => sum + p, 0) / gradedPcts.length : null;

  return { dueThisWeek, dueThisWeekTasks, overdueUngraded, unreadCount, attendanceToday, avgGradePct };
}

/** Index lists of everything scoped to one class, for the class detail
 * panel's sub-sections. Indices (not objects) so callers can build the same
 * { kind, index } targets the rest of the app already uses. */
export function classSections(data, classId) {
  const indicesWhere = (list, pred) => list.reduce((acc, item, i) => (pred(item) ? [...acc, i] : acc), []);
  return {
    assignments: indicesWhere(data.assignments, (a) => a.class_id === classId),
    assessments: indicesWhere(data.assessments, (a) => a.class_id === classId),
    discussions: indicesWhere(data.discussions, (d) => d.class_id === classId),
    files: indicesWhere(data.fileUploads, (f) => f.class_id === classId),
    roster: indicesWhere(data.enrollments, (e) => e.class_id === classId),
  };
}

export function submissionForAssignment(data, assignmentId) {
  return data.assignmentSubmissions.find((s) => s.assignment_id === assignmentId) ?? null;
}

export function gradeForAssignment(data, assignmentId) {
  return data.grades.find((g) => g.assignment_id === assignmentId) ?? null;
}

/** What came back on a piece of work, and what was turned in: the grade's
 * comment, the submission's teacher note, and the submission's own text and
 * file. Null for anything but a grade or an assignment, or when there's none
 * of it to show. */
export function teacherFeedback(target, data) {
  let grade = null;
  let assignmentId = null;
  if (target.kind === 'grade') {
    grade = data.grades[target.index] ?? null;
    assignmentId = grade?.assignment_id ?? null;
  } else if (target.kind === 'assignment') {
    assignmentId = data.assignments[target.index]?.id ?? null;
    grade = assignmentId ? gradeForAssignment(data, assignmentId) : null;
  } else {
    return null;
  }
  const sub = assignmentId ? submissionForAssignment(data, assignmentId) : null;
  const feedback = {
    comment: grade?.comment || null,
    teacherNote: sub?.teacher_note || null,
    submissionBody: sub?.body || null,
    submissionFile: sub?.file_uploads?.storage_path ? sub.file_uploads : null,
  };
  return Object.values(feedback).some(Boolean) ? feedback : null;
}

/** A submitted quiz's questions (from Meraki's app, see
 * api.getAssessmentQuestions) paired with your recorded answers, in question
 * order. `choice` is the 0-based option you picked; `isCorrect` stays null
 * until it's graded. The questions carry no answer key, so a wrong answer
 * can't show which option was right. */
export function quizReview(questions, answers) {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  return [...questions]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((q, i) => {
      const answer = byQuestion.get(q.id) ?? null;
      return {
        n: i + 1,
        prompt: q.prompt ?? '',
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        points: q.points ?? null,
        answered: answer !== null,
        choice: Number.isInteger(answer?.response?.choice) ? answer.response.choice : null,
        isCorrect: answer?.is_correct ?? null,
        pointsAwarded: answer?.points_awarded ?? null,
        feedback: answer?.feedback || null,
      };
    });
}

/** Which strike this behavior note is, counting from your first (1), or null
 * when it isn't a strike. Rows arrive newest first, so on a shared date the
 * later row is the older one. */
export function strikeNumber(data, index) {
  if (data.behaviorNotes[index]?.kind !== 'strike') return null;
  const order = data.behaviorNotes
    .map((note, i) => ({ note, i }))
    .filter(({ note }) => note.kind === 'strike')
    .sort((a, b) => (a.note.date ?? '').localeCompare(b.note.date ?? '') || b.i - a.i);
  return order.findIndex(({ i }) => i === index) + 1;
}

// assessment_submissions has no assignment_id/assessment_id scalar in the
// schema we've observed, only the embedded assessments(title, class_id) —
// so this matches on that pair. Best-effort: a title collision within the
// same class would misattribute a score, but that's a display quirk, not a
// data-integrity risk (read-only, never written back).
export function submissionForAssessment(data, assessment) {
  return (
    data.assessmentSubmissions.find(
      (s) => s.assessments?.class_id === assessment.class_id && s.assessments?.title === assessment.title,
    ) ?? null
  );
}

export function formatDateTime(iso) {
  if (!iso) return null;
  return iso.slice(0, 16).replace('T', ' ');
}

export function dayKey(iso) {
  return localDateStr(new Date(iso));
}

export function formatDaySeparator(iso, today = new Date()) {
  const diffDays = Math.round((startOfDay(iso) - startOfDay(today)) / 86400000);
  if (diffDays === 0) return t('chat.today');
  if (diffDays === -1) return t('chat.yesterday');
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatTime12(iso, use24h = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const m = String(d.getMinutes()).padStart(2, '0');
  if (use24h) return `${String(d.getHours()).padStart(2, '0')}:${m}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export function formatBytes(n) {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// The messages table is a flat inbox (sender_id/recipient_id pairs), not a
// channel model — chat mode groups it into one thread per counterparty so
// it reads like a real DM list instead of one big interleaved mailbox.
export function messageThreads(data, ownUserId) {
  const byPartner = new Map();
  data.messages.forEach((m, i) => {
    const partnerId = m.sender_id === ownUserId ? m.recipient_id : m.sender_id;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, []);
    byPartner.get(partnerId).push(i);
  });

  const threads = [];
  for (const [partnerId, indices] of byPartner) {
    indices.sort((a, b) => data.messages[a].created_at.localeCompare(data.messages[b].created_at));
    const last = data.messages[indices[indices.length - 1]];
    const unread = indices.some((i) => data.messages[i].read === false && data.messages[i].sender_id !== ownUserId);
    threads.push({ partnerId, indices, lastAt: last.created_at, unread });
  }
  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return threads;
}

export function partnerName(data, ownUserId, partnerId) {
  if (partnerId === ownUserId) return t('field.myself');
  const cls = data.classes.find((c) => c.teacher_id === partnerId);
  return cls?.teacher_name || t('field.unknown');
}

export function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function pill(text, cls = '') {
  return text ? el('span', { class: `pill ${cls}`, text }) : null;
}

export function dot(cls) {
  return el('span', { class: `dot ${cls}` });
}

function truncate(text, n) {
  if (!text) return '';
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
}

function moodClass(mood) {
  if (mood >= 4) return 'good';
  if (mood === 3) return 'dim';
  if (mood != null) return 'warn';
  return 'dim';
}

function itemRow({ leading, title, titleClass = '', pillNode, meta, preview }) {
  const top = [leading, el('span', { class: `row-title ${titleClass}`, text: title }), pillNode].filter(Boolean);
  const children = [el('div', { class: 'row-top' }, top)];
  if (meta) children.push(el('div', { class: 'row-meta', text: meta }));
  if (preview) children.push(el('div', { class: 'row-preview', text: preview }));
  return el('div', { class: 'row-item-inner' }, children);
}

// My Record: a strike filled into a carbon-copy behavior slip, for fun. Same
// data as the plain row (date, reason), just dressed up as the paperwork.
function strikeSlip(b, number) {
  const student = `${b.students?.first_name ?? ''} ${b.students?.last_name ?? ''}`.trim();
  const line = (label, value, cls = '') =>
    el('div', { class: `slip-line ${cls}` }, [
      el('span', { class: 'slip-line-label', text: label }),
      el('span', { class: 'slip-line-value', text: value || '—' }),
    ]);
  return el('div', { class: 'strike-slip' }, [
    el('div', { class: 'slip-head' }, [
      el('span', { class: 'slip-heading', text: t('slip.heading') }),
      el('span', { class: 'slip-no', text: t('slip.number', { n: String(number).padStart(3, '0') }) }),
    ]),
    line(t('slip.student'), student),
    line(t('slip.date'), b.date),
    line(t('slip.reason'), b.notes, 'slip-reason'),
    el('div', { class: 'slip-foot' }, [
      el('span', { class: 'slip-sign', text: t('slip.signature') }),
      el('span', { class: 'slip-copy', text: t('slip.copy') }),
    ]),
    el('span', { class: 'slip-stamp', 'aria-hidden': 'true', text: t('slip.stamp', { n: number }) }),
  ]);
}

export function renderItemBody(target, data, ownUserId) {
  switch (target.kind) {
    case 'class': {
      const c = data.classes[target.index];
      return itemRow({
        leading: pill(`P${c.period ?? '-'}`, 'accent'),
        title: c.name,
        meta: [c.subject, c.teacher_name, c.room ? t('field.room', { room: c.room }) : null].filter(Boolean).join(' · '),
      });
    }
    case 'grade': {
      const g = data.grades[target.index];
      const a = g.assignments;
      const possible = a?.points_possible;
      const pct = g.points_earned != null && possible ? (g.points_earned / possible) * 100 : null;
      return itemRow({
        title: a?.title ?? t('field.noAssignment'),
        pillNode: pct != null ? pill(`${pct.toFixed(0)}%`, pctClass(pct)) : null,
        meta: [`${g.points_earned ?? '-'}/${possible ?? '-'} ${t('unit.pts')}`, g.comment ? t('feedback.hasComment') : null].filter(Boolean).join(' · '),
      });
    }
    case 'assignment': {
      const a = data.assignments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name ?? '';
      return itemRow({
        title: a.title,
        pillNode: pill(a.due_date ? t('field.due', { date: a.due_date }) : null, 'accent'),
        meta: [cls, a.category, a.points_possible != null ? t('field.pts', { n: a.points_possible }) : null].filter(Boolean).join(' · '),
      });
    }
    case 'attendance': {
      const r = data.attendance[target.index];
      const sc = statusClass(r.status);
      return itemRow({
        leading: dot(sc),
        title: r.date,
        pillNode: pill(r.status, sc),
        meta: r.note ?? '',
      });
    }
    case 'calendarEvent': {
      const e = data.calendar[target.index];
      return itemRow({
        title: e.title,
        pillNode: pill(e.event_date, 'accent'),
        meta: [e.category, e.location].filter(Boolean).join(' · '),
      });
    }
    case 'reminder': {
      // Local reminders live outside `data`, so the target carries the row.
      const r = target.reminder;
      return itemRow({
        leading: dot('good'),
        title: r.title,
        pillNode: pill(t('calendar.reminder'), 'good'),
        meta: r.note ?? '',
      });
    }
    case 'announcement': {
      const a = data.announcements[target.index];
      return itemRow({
        title: a.title,
        titleClass: 'strong',
        meta: a.created_at,
        preview: truncate(a.body, 120),
      });
    }
    case 'message': {
      const m = data.messages[target.index];
      const outgoing = m.sender_id === ownUserId;
      const unread = m.read === false;
      return itemRow({
        leading: el('span', { class: `glyph ${outgoing ? 'accent' : 'accent2'}`, text: outgoing ? '↗' : '↙' }),
        title: m.subject ?? t('field.noSubject'),
        titleClass: unread ? 'strong' : 'dim',
        pillNode: unread ? dot('warn') : null,
        meta: `${outgoing ? t('field.sent') : t('field.received')} · ${m.created_at}`,
        preview: truncate(m.body, 120),
      });
    }
    case 'portfolio': {
      const p = data.portfolio[target.index];
      return itemRow({
        title: p.title,
        pillNode: pill(p.kind, 'accent2'),
        meta: t('field.added', { date: p.created_at }),
        preview: truncate(p.description, 120),
      });
    }
    case 'checkin': {
      const c = data.checkins[target.index];
      const label = c.mood ? moodLabels()[c.mood - 1] ?? '-' : '-';
      return itemRow({
        title: c.date,
        pillNode: pill(label, moodClass(c.mood)),
        meta: c.note ?? '',
      });
    }
    case 'behaviorNote': {
      const b = data.behaviorNotes[target.index];
      if (b.kind === 'strike') return strikeSlip(b, strikeNumber(data, target.index));
      return itemRow({
        title: b.date,
        pillNode: pill(b.kind, b.kind === 'strike' ? 'bad' : 'warn'),
        meta: b.notes ?? '',
      });
    }
    case 'detention': {
      const d = data.detentions[target.index];
      return itemRow({
        title: d.scheduled_date ?? '',
        pillNode: pill(d.status, 'warn'),
        meta: d.reason ?? '',
      });
    }
    case 'reportCard': {
      const r = data.reportCards[target.index];
      const pct = r.grade_pct != null ? r.grade_pct.toFixed(0) : null;
      return itemRow({
        title: r.term ?? '',
        pillNode: pill(r.letter ? `${r.letter}${pct != null ? ` · ${pct}%` : ''}` : null, pctClass(r.grade_pct)),
        meta: r.comment ?? '',
      });
    }
    case 'assessment': {
      const a = data.assessments[target.index];
      return itemRow({
        title: a.title,
        pillNode: pill(a.due_at ? t('field.due', { date: formatDateTime(a.due_at) }) : null, 'accent'),
        meta: [a.kind, a.time_limit_minutes != null ? t('field.min', { n: a.time_limit_minutes }) : null].filter(Boolean).join(' · '),
      });
    }
    case 'discussion': {
      const d = data.discussions[target.index];
      return itemRow({
        title: d.title,
        pillNode: d.closed ? pill(t('field.closed'), 'dim') : pill(d.due_date ? t('field.due', { date: d.due_date }) : null, 'accent'),
        meta: [d.graded ? `${d.points_possible ?? '-'} ${t('unit.pts')}` : null, d.required_replies ? t('field.repliesRequired', { n: d.required_replies }) : null]
          .filter(Boolean)
          .join(' · '),
        preview: truncate(d.prompt, 120),
      });
    }
    case 'fileUpload': {
      const f = data.fileUploads[target.index];
      return itemRow({
        title: f.title || f.file_name,
        pillNode: pill(formatBytes(f.size_bytes), 'accent2'),
        meta: [f.file_name, f.created_at].filter(Boolean).join(' · '),
      });
    }
    default:
      return el('div', {});
  }
}

function statTile({ label, value, cls = '', onClick, mark = null, sub = null }) {
  const alert = cls === 'bad' || cls === 'warn' ? ` alert-${cls}` : '';
  return el('button', { class: `stat-tile${alert}`, type: 'button', onclick: onClick }, [
    el('span', { class: `stat-value text-${cls}${mark ? ' stat-value-marked' : ''}`, text: value }, mark ? [mark] : []),
    el('span', { class: 'stat-label', text: label }),
    sub ? el('span', { class: 'stat-sub', text: sub }) : null,
  ]);
}

// The Overall grade tile: the letter as the headline, percentage and GPA
// estimate beneath it, and a chip for switching grading scales. The chip is a
// sibling laid over the tile's corner, not a child: a button can't hold one.
function gradeTile({ grade, notebook, draw, onClick, onPickScale }) {
  if (!grade) return statTile({ label: t('stat.overallGrade'), value: t('stat.noGrades'), cls: 'dim', onClick });
  const tile = statTile({
    label: `${t('stat.overallGrade')} · ${grade.pct.toFixed(0)}%`,
    value: grade.letter,
    cls: pctClass(grade.pct),
    sub: grade.gpa != null ? t('grade.gpaEstimate', { gpa: grade.gpa.toFixed(2) }) : null,
    mark: notebook ? gradeCircle('overall', draw) : null,
    onClick,
  });
  const scaleName = t(`grade.scale.${grade.scale}`);
  const chip = el(
    'button',
    {
      class: 'grade-scale-chip',
      type: 'button',
      title: t('grade.changeScale'),
      'aria-label': `${t('grade.changeScale')}: ${scaleName}`,
      'aria-haspopup': 'menu',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPickScale?.(r.left, r.bottom + 4);
      },
    },
    [el('span', { text: scaleName }), svgIcon(iconPaths('chevronDown'))],
  );
  return el('div', { class: 'stat-tile-group' }, [tile, chip]);
}

/** Notebook style: the teacher's red-pen circle around a grade. */
export function gradeCircle(seed, draw = false) {
  return sketchSvg([sketchCircle(40, 25, 34, 20, seededRandom(`grade:${seed}`), { turns: 1.15 })], { viewBox: [80, 50], stretch: true, draw, className: 'sketch-grade' });
}

/** The centered "nothing here" block. Notebook style swaps the dot for a
 * margin doodle (a star and a spiral) that draws in on a fresh visit. */
export function emptyState(text, { notebook = false, draw = false } = {}) {
  const icon = notebook
    ? sketchSvg([sketchStar(18, 21, 13, seededRandom(`doodle-star:${text}`)), sketchSpiral(47, 21, 11, seededRandom(`doodle-spiral:${text}`))], { viewBox: [64, 42], draw, className: 'sketch-doodle' })
    : el('div', { class: 'empty-icon', text: '·' });
  return el('div', { class: 'empty-state' }, [icon, el('p', { text })]);
}

// Notebook style's attendance summary: each status's days as tally marks in
// groups of five, with the count written beside them so nobody has to count
// strokes. Known statuses first, anything else after in first-seen order.
const TALLY_ORDER = ['present', 'tardy', 'late', 'absent', 'excused'];
export function renderAttendanceTally(records, { draw = false } = {}) {
  const counts = new Map();
  for (const r of records) {
    const status = String(r.status ?? '').toLowerCase() || '-';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const rank = (status) => {
    const i = TALLY_ORDER.indexOf(status);
    return i === -1 ? TALLY_ORDER.length : i;
  };
  const statuses = [...counts.keys()].sort((a, b) => rank(a) - rank(b));
  return el('div', { class: 'attendance-tally' }, statuses.map((status) => {
    const count = counts.get(status);
    const groups = tallyGroups(count).map((n, g) =>
      sketchSvg(sketchTallyGroup(n, seededRandom(`tally:${status}:${g}`)), { viewBox: [30, 24], draw, drawOffset: g * 5, className: 'sketch-tally' }),
    );
    return el('div', { class: 'attendance-tally-row' }, [
      pill(status, statusClass(status)),
      el('div', { class: 'attendance-tally-marks' }, groups),
      el('span', { class: 'attendance-tally-count', text: String(count) }),
    ]);
  }));
}

/** The stat row at the top of Overview — always shows all five tiles, even
 * at zero, since "nothing overdue" and "no unread messages" are useful
 * things to confirm, not just states to hide. */
export function renderOverviewStats(summary, onNavigate, { notebook = false, draw = false, grade = null, onPickScale = null } = {}) {
  const { dueThisWeek, overdueUngraded, unreadCount, attendanceToday } = summary;
  return el('div', { class: 'stat-grid' }, [
    statTile({
      label: t('stat.dueThisWeek'),
      value: String(dueThisWeek.length),
      cls: dueThisWeek.length > 0 ? 'accent' : 'good',
      onClick: () => onNavigate('assignments'),
    }),
    statTile({
      label: t('stat.overdueUngraded'),
      value: String(overdueUngraded.length),
      cls: overdueUngraded.length > 0 ? 'bad' : 'good',
      onClick: () => onNavigate('assignments'),
    }),
    statTile({
      label: t('stat.unreadMessages'),
      value: String(unreadCount),
      cls: unreadCount > 0 ? 'accent' : 'good',
      onClick: () => onNavigate('messages'),
    }),
    statTile({
      label: t('stat.attendanceToday'),
      value: attendanceToday ? attendanceToday.status : t('stat.noRecord'),
      cls: attendanceToday ? statusClass(attendanceToday.status) : 'dim',
      onClick: () => onNavigate('attendance'),
    }),
    gradeTile({ grade, notebook, draw, onClick: () => onNavigate('grades'), onPickScale }),
  ]);
}

export function fieldDisplay(value) {
  return value === '' || value == null ? t('field.noData') : String(value);
}

export function renderInfoRow(data) {
  const hero = data.hero;
  return el('div', { class: 'hero-card' }, [
    el('span', { class: 'hero-label', text: t('hero.class') }),
    el('span', { class: 'hero-value', text: hero?.hero_class ?? '—' }),
    el('span', { class: 'hero-meta', text: hero?.quest_started_at ? t('hero.started', { date: hero.quest_started_at }) : '' }),
  ]);
}

export function detailFields(target, data) {
  switch (target.kind) {
    case 'class': {
      const c = data.classes[target.index];
      return { title: c.name, fields: [[t('label.subject'), c.subject], [t('label.period'), c.period], [t('label.room'), c.room], [t('label.term'), c.term], [t('label.teacher'), c.teacher_name]] };
    }
    case 'grade': {
      const g = data.grades[target.index];
      const a = g.assignments;
      return { title: a?.title ?? t('field.noAssignment'), fields: [[t('label.score'), `${g.points_earned ?? '-'}/${a?.points_possible ?? '-'}`], [t('label.due'), a?.due_date], [t('label.updated'), g.updated_at]] };
    }
    case 'assignment': {
      const a = data.assignments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name;
      const sub = submissionForAssignment(data, a.id);
      const grade = gradeForAssignment(data, a.id);
      return {
        title: a.title,
        fields: [
          [t('label.class'), cls],
          [t('label.due'), a.due_date],
          [t('label.points'), a.points_possible],
          [t('label.yourScore'), grade?.points_earned != null ? `${grade.points_earned}/${a.points_possible ?? '-'}` : null],
          [t('label.category'), a.category],
          [t('label.submissionMode'), a.submission_mode],
          [t('label.submitted'), sub?.submitted_at ? formatDateTime(sub.submitted_at) : null],
          [t('label.submissionStatus'), sub?.status],
        ],
        body: a.description ?? null,
      };
    }
    case 'attendance': {
      const r = data.attendance[target.index];
      return { title: r.date, fields: [[t('label.status'), r.status], [t('label.note'), r.note]] };
    }
    case 'calendarEvent': {
      const e = data.calendar[target.index];
      const time = e.start_time || e.end_time ? `${e.start_time ?? '?'}–${e.end_time ?? '?'}` : null;
      return { title: e.title, fields: [[t('label.date'), e.event_date], [t('label.time'), time], [t('label.location'), e.location]], body: e.description ?? null };
    }
    case 'reminder': {
      const r = target.reminder;
      return { title: r.title, fields: [[t('label.date'), r.date]], body: r.note ?? null };
    }
    case 'announcement': {
      const a = data.announcements[target.index];
      return { title: a.title, fields: [[t('label.posted'), a.created_at]], body: a.body ?? null };
    }
    case 'message': {
      const m = data.messages[target.index];
      return { title: m.subject ?? t('field.noSubject'), fields: [[t('label.date'), m.created_at]], body: m.body ?? null };
    }
    case 'portfolio': {
      const p = data.portfolio[target.index];
      return { title: p.title, fields: [[t('label.kind'), p.kind], [t('label.added'), p.created_at], [t('label.link'), p.link]], body: p.description ?? null };
    }
    case 'checkin': {
      const c = data.checkins[target.index];
      return { title: c.date, fields: [[t('label.mood'), c.mood ? moodLabels()[c.mood - 1] : null]], body: c.note ?? null };
    }
    case 'behaviorNote': {
      const b = data.behaviorNotes[target.index];
      return { title: b.date, fields: [[t('label.kind'), b.kind]], body: b.notes ?? null };
    }
    case 'detention': {
      const d = data.detentions[target.index];
      return { title: d.scheduled_date, fields: [[t('label.status'), d.status], [t('label.strikeCount'), d.strike_count], [t('label.reason'), d.reason]], body: d.notes ?? null };
    }
    case 'reportCard': {
      const r = data.reportCards[target.index];
      const pct = r.grade_pct != null ? r.grade_pct.toFixed(0) : null;
      const grade = r.letter || pct != null ? `${r.letter ?? ''}${pct != null ? ` (${pct}%)` : ''}`.trim() : null;
      return { title: r.term, fields: [[t('label.grade'), grade], [t('label.updated'), r.updated_at]], body: r.comment ?? null };
    }
    case 'assessment': {
      const a = data.assessments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name;
      const sub = submissionForAssessment(data, a);
      const score = sub ? `${sub.manual_score ?? sub.auto_score ?? '-'}/${sub.total_points ?? '-'}` : null;
      return {
        title: a.title,
        fields: [
          [t('label.class'), cls],
          [t('label.kind'), a.kind],
          [t('label.due'), a.due_at ? formatDateTime(a.due_at) : null],
          [t('label.timeLimit'), a.time_limit_minutes != null ? t('field.min', { n: a.time_limit_minutes }) : null],
          [t('label.yourScore'), score],
          [t('label.submitted'), sub?.submitted_at ? formatDateTime(sub.submitted_at) : null],
        ],
        body: a.instructions ?? null,
      };
    }
    case 'discussion': {
      const d = data.discussions[target.index];
      const cls = d.classes?.name ?? data.classes.find((c) => c.id === d.class_id)?.name;
      return {
        title: d.title,
        fields: [
          [t('label.class'), cls],
          [t('label.due'), d.due_date],
          [t('label.status'), d.closed ? t('field.closed') : t('label.open')],
          [t('label.requiredReplies'), d.required_replies],
          [t('label.points'), d.graded ? d.points_possible : null],
        ],
        body: d.prompt ?? null,
      };
    }
    case 'fileUpload': {
      const f = data.fileUploads[target.index];
      const cls = f.classes?.name ?? data.classes.find((c) => c.id === f.class_id)?.name;
      return {
        title: f.title || f.file_name,
        fields: [
          [t('label.class'), cls],
          [t('label.fileName'), f.file_name],
          [t('label.type'), f.mime_type],
          [t('label.size'), formatBytes(f.size_bytes)],
          [t('label.uploaded'), f.created_at],
        ],
      };
    }
    default:
      return { title: '', fields: [] };
  }
}
