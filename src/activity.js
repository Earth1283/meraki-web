// Meraki's own cross-cutting activity feed (see api.js's getActivityFeed):
// grades, announcements, assignments, submissions and messages pre-joined
// into one list. `kind` is an open string set — only the ones below have
// ever been observed — so anything else still has to render, not throw.
import { el, svgIcon } from './dom.js';
import { t, getDateLocale } from './i18n.js';
import { iconPaths } from './icons.js';
import { pill } from './rows.js';

const KIND_META = {
  grade: { icon: 'grades', labelKey: 'activity.kind.grade' },
  announcement: { icon: 'announcements', labelKey: 'activity.kind.announcement' },
  assignment: { icon: 'assignments', labelKey: 'activity.kind.assignment' },
  submission: { icon: 'check', labelKey: 'activity.kind.submission' },
  message: { icon: 'messages', labelKey: 'activity.kind.message' },
};
const FALLBACK_META = { icon: 'more', labelKey: null };

/** A known kind's icon and label key, or a generic icon with `labelKey: null`
 * for anything Meraki adds later — the caller humanises the raw kind itself
 * in that case, since there's no translation for a value that didn't exist
 * when this shipped. */
export function activityKindMeta(kind) {
  return KIND_META[kind] ?? FALLBACK_META;
}

function humanizeKind(kind) {
  return kind ? String(kind).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/** The previous sign-in's timestamp — loginEvents[0] is the session that's
 * looking at the feed right now, so the watermark for "new" has to be the
 * one after it. Fewer than two recorded sign-ins (first login ever, or a
 * trimmed history) means there's nothing to compare against. */
export function previousSignIn(loginEvents) {
  if (!Array.isArray(loginEvents) || loginEvents.length < 2) return null;
  return loginEvents[1]?.signed_in_at ?? null;
}

export function newCount(items, since) {
  if (!since || !Array.isArray(items)) return 0;
  const sinceMs = Date.parse(since);
  return items.filter((item) => item?.at && Date.parse(item.at) > sinceMs).length;
}

export const ACTIVITY_FEED_LIMIT = 15;

function startOfDay(at) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayHeaderLabel(at, now) {
  const diffDays = Math.round((startOfDay(at).getTime() - startOfDay(now).getTime()) / 86400000);
  if (diffDays === 0) return t('activity.today');
  if (diffDays === -1) return t('activity.yesterday');
  return new Date(at).toLocaleDateString(getDateLocale(), { weekday: 'long', month: 'long', day: 'numeric' });
}

/** A flat, newest-first row list — `{ type: 'header', label }` between day
 * groups and `{ type: 'item', item, isNew }` per activity — capped at
 * `limit` so a feed that's been quiet for months doesn't turn into an
 * endless scroll. `since` is a previousSignIn() watermark; omit it (or pass
 * null) to mark nothing as new. */
export function activityRows(items, { since = null, now = new Date(), limit = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const sinceMs = since ? Date.parse(since) : null;
  const sorted = [...items].filter((item) => item?.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const capped = limit ? sorted.slice(0, limit) : sorted;

  const rows = [];
  let currentKey = null;
  for (const item of capped) {
    const key = startOfDay(item.at).getTime();
    if (key !== currentKey) {
      currentKey = key;
      rows.push({ type: 'header', label: dayHeaderLabel(item.at, now) });
    }
    rows.push({ type: 'item', item, isNew: sinceMs != null && Date.parse(item.at) > sinceMs });
  }
  return rows;
}

function formatClock(at) {
  return new Date(at).toLocaleTimeString(getDateLocale(), { hour: 'numeric', minute: '2-digit' });
}

function activityItemEl(item, isNew) {
  const meta = activityKindMeta(item.kind);
  const kindLabel = meta.labelKey ? t(meta.labelKey) : humanizeKind(item.kind);
  const title = item.title || kindLabel;
  const metaLine = [item.className, item.studentName, formatClock(item.at)].filter(Boolean).join(' · ');

  return el('div', { class: `activity-item ${isNew ? 'is-new' : ''}` }, [
    el('span', { class: 'activity-icon' }, [svgIcon(iconPaths(meta.icon))]),
    el('div', { class: 'activity-item-body' }, [
      el('div', { class: 'activity-item-top' }, [
        el('span', { class: 'activity-item-title', text: title }),
        isNew ? pill(t('activity.newBadge'), 'accent') : null,
      ]),
      item.subtitle && item.subtitle !== title ? el('div', { class: 'activity-item-subtitle', text: item.subtitle }) : null,
      metaLine ? el('div', { class: 'activity-item-meta', text: metaLine }) : null,
      item.body ? el('div', { class: 'activity-item-note', text: item.body }) : null,
    ]),
  ]);
}

/** Everything the widget below decides, without a DOM in sight. `overflow`
 * counts only the items the list could actually have shown: an item with no
 * timestamp can't be placed under a day, so activityRows drops it, and
 * counting raw input here would promise more rows than exist. */
export function activityFeedView(items, loginEvents, { now = new Date() } = {}) {
  const since = previousSignIn(loginEvents);
  const rows = activityRows(items, { since, now, limit: ACTIVITY_FEED_LIMIT });
  const datedTotal = activityRows(items, { since, now }).filter((row) => row.type === 'item').length;
  return {
    rows,
    isEmpty: rows.length === 0,
    newCount: rows.length === 0 ? 0 : newCount(items, since),
    overflow: Math.max(0, datedTotal - ACTIVITY_FEED_LIMIT),
  };
}

/** The Overview tab's activity widget: a calm empty state for a retired or
 * empty feed, a compact "N new since your last sign-in" line when there's
 * anything to flag, then the day-grouped list itself, capped and with a
 * plain "+N more" line rather than a way to page or drill into the rest. */
export function renderActivityFeed(items, loginEvents) {
  const container = el('div', { class: 'activity-feed' });
  const view = activityFeedView(items, loginEvents);

  if (view.isEmpty) {
    container.appendChild(el('p', { class: 'activity-empty', text: t('activity.empty') }));
    return container;
  }

  if (view.newCount > 0) {
    container.appendChild(el('div', { class: 'activity-banner', text: t('activity.newSince', { n: view.newCount }) }));
  }

  const list = el('div', { class: 'activity-list' });
  for (const row of view.rows) {
    list.appendChild(row.type === 'header'
      ? el('div', { class: 'activity-day', text: row.label })
      : activityItemEl(row.item, row.isNew));
  }
  container.appendChild(list);

  if (view.overflow > 0) {
    container.appendChild(el('p', { class: 'activity-more', text: t('activity.moreNotShown', { n: view.overflow }) }));
  }
  return container;
}
