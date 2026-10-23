import { el, svgIcon } from './dom.js';
import { iconPaths } from './icons.js';
import { t } from './i18n.js';

const VIEWPORT_MARGIN = 8;

const causeText = ({ kind, status }) => t(`error.cause.${kind}`, { status });

function failureRow(failure) {
  return el('li', { class: 'error-info-item' }, [
    el('strong', { class: 'error-info-source', text: t('error.source', { label: failure.label }) }),
    el('span', { text: causeText(failure) }),
    failure.technical ? el('code', { class: 'error-info-technical', text: failure.technical }) : null,
  ]);
}

/** Slides the popover sideways until it sits inside the viewport. */
function keepOnScreen(popover) {
  popover.style.transform = '';
  const { left, right } = popover.getBoundingClientRect();
  const overflow = left < VIEWPORT_MARGIN
    ? VIEWPORT_MARGIN - left
    : Math.min(0, document.documentElement.clientWidth - VIEWPORT_MARGIN - right);
  if (overflow) popover.style.transform = `translateX(${overflow}px)`;
}

/** An (i) button that explains what behind a load error actually failed.
 * Shows on hover or keyboard focus; a click pins it open for touch screens. */
export function errorInfoButton(failures) {
  if (!failures?.length) return null;
  const popover = el('div', { class: 'error-info-popover', role: 'tooltip' }, [
    el('ul', { class: 'error-info-list' }, failures.map(failureRow)),
  ]);
  const button = el('button', {
    class: 'error-info-button',
    type: 'button',
    'aria-label': t('error.details'),
    'aria-expanded': 'false',
  }, [svgIcon(iconPaths('info'))]);
  const wrap = el('span', { class: 'error-info' }, [button, popover]);

  const place = () => requestAnimationFrame(() => keepOnScreen(popover));
  const setPinned = (pinned) => {
    wrap.classList.toggle('is-pinned', pinned);
    button.setAttribute('aria-expanded', String(pinned));
    if (pinned) place();
  };
  const dismissOutside = (event) => {
    if (wrap.contains(event.target)) return;
    document.removeEventListener('pointerdown', dismissOutside);
    setPinned(false);
  };

  button.addEventListener('click', () => {
    const pinned = !wrap.classList.contains('is-pinned');
    setPinned(pinned);
    if (pinned) document.addEventListener('pointerdown', dismissOutside);
  });
  wrap.addEventListener('mouseenter', place);
  wrap.addEventListener('focusin', place);
  wrap.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !wrap.contains(document.activeElement)) return;
    event.stopPropagation();
    setPinned(false);
    button.blur();
  });
  return wrap;
}
