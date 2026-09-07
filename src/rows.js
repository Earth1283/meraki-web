import { el } from './dom.js';

export const MOOD_LABELS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];

export const TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'classes', title: 'Classes' },
  { id: 'grades', title: 'Grades' },
  { id: 'assignments', title: 'Assignments' },
  { id: 'attendance', title: 'Attendance' },
  { id: 'calendar', title: 'Calendar' },
  { id: 'announcements', title: 'Announcements' },
  { id: 'messages', title: 'Messages' },
  { id: 'me', title: 'Me' },
  { id: 'myrecord', title: 'My Record' },
  { id: 'privacy', title: 'Data & Privacy' },
];

export function tabTitle(id) {
  return TABS.find((t) => t.id === id)?.title ?? id;
}

export function commandLabels() {
  return [...TABS.map((t) => `Go to ${t.title}`), 'Refresh data', 'Open settings', 'Log out'];
}

/** All known tab ids, arranged per config.tabOrder — any id missing from a
 * stored order (new tabs shipped after the config was saved) is appended at
 * the end, so a saved order never silently hides a tab that didn't exist
 * yet when it was written. */
export function orderedTabIds(config) {
  const knownIds = TABS.map((t) => t.id);
  const known = new Set(knownIds);
  const stored = (config.tabOrder || []).filter((id) => known.has(id));
  const missing = knownIds.filter((id) => !stored.includes(id));
  return [...stored, ...missing];
}

export function orderedTabs(config) {
  return orderedTabIds(config).map((id) => TABS.find((t) => t.id === id));
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

      rows.push({ type: 'collapsible-header', section: 'todo', label: 'To Be Done', count: todo.length, collapsed: todoCollapsed });
      if (!todoCollapsed) {
        if (todo.length === 0) {
          rows.push({ type: 'placeholder', text: "Nothing due in the next 7 days — you're caught up." });
        } else {
          todo.forEach((t) => rows.push({ type: 'item', target: { kind: t.kind, index: t.index } }));
        }
      }
      // Only shown once something's actually done — an empty "Done" section
      // collapsed by default would just be a header that never earns its
      // place on screen.
      if (done.length > 0) {
        rows.push({ type: 'collapsible-header', section: 'done', label: 'Done', count: done.length, collapsed: doneCollapsed });
        if (!doneCollapsed) {
          done.forEach((t) => rows.push({ type: 'item', target: { kind: t.kind, index: t.index }, done: true }));
        }
      }
      rows.push({ type: 'header', label: 'Recent announcements' });
      const recent = data.announcements.slice(0, 5);
      if (recent.length === 0) {
        rows.push({ type: 'placeholder', text: 'No announcements yet.' });
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
      rows.push({ type: 'header', label: 'Portfolio' });
      if (data.portfolio.length === 0) rows.push({ type: 'placeholder', text: '(none yet)' });
      else data.portfolio.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'portfolio', index: i } }));
      rows.push({ type: 'header', label: 'Check-ins' });
      if (data.checkins.length === 0) rows.push({ type: 'placeholder', text: '(none yet)' });
      else data.checkins.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'checkin', index: i } }));
      break;
    }
    case 'myrecord': {
      rows.push({ type: 'header', label: 'Behavior notes' });
      if (data.behaviorNotes.length === 0) rows.push({ type: 'placeholder', text: '(none on file)' });
      else data.behaviorNotes.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'behaviorNote', index: i } }));
      rows.push({ type: 'header', label: 'Detentions' });
      if (data.detentions.length === 0) rows.push({ type: 'placeholder', text: '(none on file)' });
      else data.detentions.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'detention', index: i } }));
      rows.push({ type: 'header', label: 'Report cards' });
      if (data.reportCards.length === 0) rows.push({ type: 'placeholder', text: '(none published)' });
      else data.reportCards.forEach((_, i) => rows.push({ type: 'item', target: { kind: 'reportCard', index: i } }));
      break;
    }
    case 'privacy':
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
  const overdueUngraded = [];
  data.assignments.forEach((a, i) => {
    const delta = daysUntil(a.due_date, today);
    if (delta == null) return;
    if (delta >= 0 && delta <= 6) {
      dueThisWeek.push(i);
      dueThisWeekTasks.push({ kind: 'assignment', index: i, dueDate: a.due_date, done: !!submissionForAssignment(data, a.id) });
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
  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
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
  if (partnerId === ownUserId) return 'Myself';
  const cls = data.classes.find((c) => c.teacher_id === partnerId);
  return cls?.teacher_name || 'Unknown';
}

export function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pill(text, cls = '') {
  return text ? el('span', { class: `pill ${cls}`, text }) : null;
}

function dot(cls) {
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

export function renderItemBody(target, data, ownUserId) {
  switch (target.kind) {
    case 'class': {
      const c = data.classes[target.index];
      return itemRow({
        leading: pill(`P${c.period ?? '-'}`, 'accent'),
        title: c.name,
        meta: [c.subject, c.teacher_name, c.room ? `Room ${c.room}` : null].filter(Boolean).join(' · '),
      });
    }
    case 'grade': {
      const g = data.grades[target.index];
      const a = g.assignments;
      const possible = a?.points_possible;
      const pct = g.points_earned != null && possible ? (g.points_earned / possible) * 100 : null;
      return itemRow({
        title: a?.title ?? '(assignment)',
        pillNode: pct != null ? pill(`${pct.toFixed(0)}%`, pctClass(pct)) : null,
        meta: `${g.points_earned ?? '-'}/${possible ?? '-'} pts`,
      });
    }
    case 'assignment': {
      const a = data.assignments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name ?? '';
      return itemRow({
        title: a.title,
        pillNode: pill(a.due_date ? `Due ${a.due_date}` : null, 'accent'),
        meta: [cls, a.category, a.points_possible != null ? `${a.points_possible} pts` : null].filter(Boolean).join(' · '),
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
        title: m.subject ?? '(no subject)',
        titleClass: unread ? 'strong' : 'dim',
        pillNode: unread ? dot('warn') : null,
        meta: `${outgoing ? 'Sent' : 'Received'} · ${m.created_at}`,
        preview: truncate(m.body, 120),
      });
    }
    case 'portfolio': {
      const p = data.portfolio[target.index];
      return itemRow({
        title: p.title,
        pillNode: pill(p.kind, 'accent2'),
        meta: `Added ${p.created_at}`,
        preview: truncate(p.description, 120),
      });
    }
    case 'checkin': {
      const c = data.checkins[target.index];
      const label = c.mood ? MOOD_LABELS[c.mood - 1] ?? '-' : '-';
      return itemRow({
        title: c.date,
        pillNode: pill(label, moodClass(c.mood)),
        meta: c.note ?? '',
      });
    }
    case 'behaviorNote': {
      const b = data.behaviorNotes[target.index];
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
        pillNode: pill(a.due_at ? `Due ${formatDateTime(a.due_at)}` : null, 'accent'),
        meta: [a.kind, a.time_limit_minutes != null ? `${a.time_limit_minutes} min` : null].filter(Boolean).join(' · '),
      });
    }
    case 'discussion': {
      const d = data.discussions[target.index];
      return itemRow({
        title: d.title,
        pillNode: d.closed ? pill('Closed', 'dim') : pill(d.due_date ? `Due ${d.due_date}` : null, 'accent'),
        meta: [d.graded ? `${d.points_possible ?? '-'} pts` : null, d.required_replies ? `${d.required_replies} replies required` : null]
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

function statTile({ label, value, cls = '', onClick }) {
  const alert = cls === 'bad' || cls === 'warn' ? ` alert-${cls}` : '';
  return el('button', { class: `stat-tile${alert}`, type: 'button', onclick: onClick }, [
    el('span', { class: `stat-value text-${cls}`, text: value }),
    el('span', { class: 'stat-label', text: label }),
  ]);
}

/** The stat row at the top of Overview — always shows all five tiles, even
 * at zero, since "nothing overdue" and "no unread messages" are useful
 * things to confirm, not just states to hide. */
export function renderOverviewStats(summary, onNavigate) {
  const { dueThisWeek, overdueUngraded, unreadCount, attendanceToday, avgGradePct } = summary;
  return el('div', { class: 'stat-grid' }, [
    statTile({
      label: 'Due this week',
      value: String(dueThisWeek.length),
      cls: dueThisWeek.length > 0 ? 'accent' : 'good',
      onClick: () => onNavigate('assignments'),
    }),
    statTile({
      label: 'Overdue, ungraded',
      value: String(overdueUngraded.length),
      cls: overdueUngraded.length > 0 ? 'bad' : 'good',
      onClick: () => onNavigate('assignments'),
    }),
    statTile({
      label: 'Unread messages',
      value: String(unreadCount),
      cls: unreadCount > 0 ? 'accent' : 'good',
      onClick: () => onNavigate('messages'),
    }),
    statTile({
      label: 'Attendance today',
      value: attendanceToday ? attendanceToday.status : 'No record',
      cls: attendanceToday ? statusClass(attendanceToday.status) : 'dim',
      onClick: () => onNavigate('attendance'),
    }),
    statTile({
      label: 'Overall grade',
      value: avgGradePct != null ? `${avgGradePct.toFixed(0)}%` : 'No grades',
      cls: avgGradePct != null ? pctClass(avgGradePct) : 'dim',
      onClick: () => onNavigate('grades'),
    }),
  ]);
}

export function fieldDisplay(value) {
  return value === '' || value == null ? 'No data' : String(value);
}

export function renderInfoRow(data) {
  const hero = data.hero;
  return el('div', { class: 'hero-card' }, [
    el('span', { class: 'hero-label', text: 'Hero class' }),
    el('span', { class: 'hero-value', text: hero?.hero_class ?? '—' }),
    el('span', { class: 'hero-meta', text: hero?.quest_started_at ? `Started ${hero.quest_started_at}` : '' }),
  ]);
}

export function detailFields(target, data) {
  switch (target.kind) {
    case 'class': {
      const c = data.classes[target.index];
      return { title: c.name, fields: [['Subject', c.subject], ['Period', c.period], ['Room', c.room], ['Term', c.term], ['Teacher', c.teacher_name]] };
    }
    case 'grade': {
      const g = data.grades[target.index];
      const a = g.assignments;
      return { title: a?.title ?? '(assignment)', fields: [['Score', `${g.points_earned ?? '-'}/${a?.points_possible ?? '-'}`], ['Due', a?.due_date], ['Updated', g.updated_at]] };
    }
    case 'assignment': {
      const a = data.assignments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name;
      const sub = submissionForAssignment(data, a.id);
      return {
        title: a.title,
        fields: [
          ['Class', cls],
          ['Due', a.due_date],
          ['Points', a.points_possible],
          ['Category', a.category],
          ['Submission mode', a.submission_mode],
          ['Submitted', sub?.submitted_at ? formatDateTime(sub.submitted_at) : null],
          ['Submission status', sub?.status],
        ],
        body: a.description ?? null,
      };
    }
    case 'attendance': {
      const r = data.attendance[target.index];
      return { title: r.date, fields: [['Status', r.status], ['Note', r.note]] };
    }
    case 'calendarEvent': {
      const e = data.calendar[target.index];
      const time = e.start_time || e.end_time ? `${e.start_time ?? '?'}–${e.end_time ?? '?'}` : null;
      return { title: e.title, fields: [['Date', e.event_date], ['Time', time], ['Location', e.location]], body: e.description ?? null };
    }
    case 'announcement': {
      const a = data.announcements[target.index];
      return { title: a.title, fields: [['Posted', a.created_at]], body: a.body ?? null };
    }
    case 'message': {
      const m = data.messages[target.index];
      return { title: m.subject ?? '(no subject)', fields: [['Date', m.created_at]], body: m.body ?? null };
    }
    case 'portfolio': {
      const p = data.portfolio[target.index];
      return { title: p.title, fields: [['Kind', p.kind], ['Added', p.created_at], ['Link', p.link]], body: p.description ?? null };
    }
    case 'checkin': {
      const c = data.checkins[target.index];
      return { title: c.date, fields: [['Mood', c.mood ? MOOD_LABELS[c.mood - 1] : null]], body: c.note ?? null };
    }
    case 'behaviorNote': {
      const b = data.behaviorNotes[target.index];
      return { title: b.date, fields: [['Kind', b.kind]], body: b.notes ?? null };
    }
    case 'detention': {
      const d = data.detentions[target.index];
      return { title: d.scheduled_date, fields: [['Status', d.status], ['Strike count', d.strike_count], ['Reason', d.reason]], body: d.notes ?? null };
    }
    case 'reportCard': {
      const r = data.reportCards[target.index];
      const pct = r.grade_pct != null ? r.grade_pct.toFixed(0) : null;
      const grade = r.letter || pct != null ? `${r.letter ?? ''}${pct != null ? ` (${pct}%)` : ''}`.trim() : null;
      return { title: r.term, fields: [['Grade', grade], ['Updated', r.updated_at]], body: r.comment ?? null };
    }
    case 'assessment': {
      const a = data.assessments[target.index];
      const cls = a.classes?.name ?? data.classes.find((c) => c.id === a.class_id)?.name;
      const sub = submissionForAssessment(data, a);
      const score = sub ? `${sub.manual_score ?? sub.auto_score ?? '-'}/${sub.total_points ?? '-'}` : null;
      return {
        title: a.title,
        fields: [
          ['Class', cls],
          ['Kind', a.kind],
          ['Due', a.due_at ? formatDateTime(a.due_at) : null],
          ['Time limit', a.time_limit_minutes != null ? `${a.time_limit_minutes} min` : null],
          ['Your score', score],
          ['Submitted', sub?.submitted_at ? formatDateTime(sub.submitted_at) : null],
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
          ['Class', cls],
          ['Due', d.due_date],
          ['Status', d.closed ? 'Closed' : 'Open'],
          ['Required replies', d.required_replies],
          ['Points', d.graded ? d.points_possible : null],
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
          ['Class', cls],
          ['File name', f.file_name],
          ['Type', f.mime_type],
          ['Size', formatBytes(f.size_bytes)],
          ['Uploaded', f.created_at],
        ],
      };
    }
    default:
      return { title: '', fields: [] };
  }
}
