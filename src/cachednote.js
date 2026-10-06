import { el } from './dom.js';
import { t, getDateLocale } from './i18n.js';
import { snapshotAge } from './snapshot.js';

function ageLabel(savedAt) {
  const { value, unit } = snapshotAge(savedAt);
  return new Intl.RelativeTimeFormat(getDateLocale(), { numeric: 'auto' }).format(value, unit);
}

/** The strip shown while the on-screen data is the saved copy from an
 * earlier visit rather than a fresh fetch. */
export function renderCachedNote({ savedAt, updating }) {
  const when = ageLabel(savedAt);
  const text = updating ? t('cache.updating', { when }) : t('cache.stale', { when });
  return el('div', { class: `banner-cached ${updating ? 'is-updating' : ''}`, role: 'status' }, [
    updating ? el('span', { class: 'spinner spinner-sm' }) : null,
    el('span', { text }),
  ]);
}
