// "Load more" at the foot of a paged list. The paging itself is loadMore in
// state.js; this is just the button, and the watcher that presses it for you
// once it scrolls into view.
import { el } from './dom.js';
import { state, loadMore } from './state.js';
import { hasMoreRows } from './paging.js';
import { t } from './i18n.js';

// The paged fields each tab's list pages through. Submissions have no list of
// their own; they page from the Assignments tab, where their submitted/done
// status shows up.
const PAGED_TAB_FIELDS = {
  grades: ['grades'],
  attendance: ['attendance'],
  assignments: ['assignmentSubmissions', 'assessmentSubmissions'],
};

let observer = null;

/** Stops the previous render's auto-load watcher. Call before rebuilding the body. */
export function disconnectLoadMore() {
  observer?.disconnect();
  observer = null;
}

/** How much of the tab's list is loaded, and a Load more button that also
 * fires by itself once it scrolls into view. After a failed load it waits for
 * a click on Retry instead of re-firing a request that just failed. Null when
 * there's nothing more to load. `refocus` moves focus to the new button, since
 * a re-render replaces the one that had it. */
export function renderLoadMore(tab, { refocus = false } = {}) {
  const fields = (PAGED_TAB_FIELDS[tab] ?? []).filter((f) => state.pages[f]?.error || hasMoreRows(state.data[f].length, state.pages[f]));
  if (fields.length === 0) return null;
  const pages = fields.map((f) => state.pages[f]);
  const loading = pages.some((p) => p.loading);
  const error = pages.find((p) => p.error)?.error ?? null;
  const loadAll = () => fields.forEach((f) => loadMore(f));

  const count = fields.length === 1 && pages[0].total != null ? t('list.shownOf', { shown: state.data[fields[0]].length, total: pages[0].total }) : null;
  const label = loading ? t('list.loadingMore') : error ? t('state.retry') : tab === 'assignments' ? t('list.loadOlderSubmissions') : t('list.loadMore');
  const button = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: loading, onclick: loadAll, text: label });
  const node = el('div', { class: 'load-more' }, [
    error ? el('span', { class: 'load-more-error', role: 'alert', text: error }) : null,
    count ? el('span', { class: 'load-more-count', text: count }) : null,
    button,
  ]);

  if (!loading && !error && 'IntersectionObserver' in window) {
    disconnectLoadMore();
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      disconnectLoadMore();
      loadAll();
    }, { rootMargin: '0px 0px 240px 0px' });
    observer.observe(node);
  }
  if (refocus && !loading) queueMicrotask(() => button.focus());
  return node;
}
