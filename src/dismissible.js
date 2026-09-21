import { el, svgIcon } from './dom.js';
import { iconPaths } from './icons.js';
import { t } from './i18n.js';

const dismissed = new Set();

export const isErrorDismissed = (message) => dismissed.has(message);

export const restoreError = (message) => dismissed.delete(message);

export function dismissButton(message, onDismiss) {
  return el('button', {
    class: 'error-dismiss',
    type: 'button',
    'aria-label': t('state.dismiss'),
    title: t('state.dismiss'),
    onclick: () => { dismissed.add(message); onDismiss(); },
  }, [svgIcon(iconPaths('close'))]);
}
