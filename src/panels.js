// Pieces shared by the overlay dialogs.
import { el, svgIcon } from './dom.js';
import { iconPaths } from './icons.js';
import { closeOverlay } from './state.js';
import { t } from './i18n.js';

export function backdrop(onClose) {
  return el('div', { class: 'overlay-backdrop', onclick: onClose });
}

export function closeButton() {
  return el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('detail.close'), onclick: closeOverlay }, [svgIcon(iconPaths('close'))]);
}

/** A right-hand side panel dialog titled `title`, holding `content`. */
export function sidePanel(title, content) {
  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: title }), closeButton()]),
    content,
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}
