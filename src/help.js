// The keyboard-shortcuts help dialog.
import { el } from './dom.js';
import { closeOverlay } from './state.js';
import { t } from './i18n.js';
import { backdrop, closeButton } from './panels.js';

export function buildHelp() {
  const rows = [
    ['j / ↓, k / ↑', t('help.moveSelection')],
    ['Enter', t('help.openDetail')],
    ['Ctrl/⌘+P', t('help.commandPalette')],
    ['n', t('help.newMessage')],
    ['r', t('help.refresh')],
    [',', t('help.settings')],
    ['?', t('help.thisHelp')],
  ];
  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('help.title') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('help.title') }), closeButton()]),
    el(
      'div',
      { class: 'help-rows' },
      rows.map(([k, d]) => el('div', { class: 'help-row' }, [el('kbd', { text: k }), el('span', { text: d })])),
    ),
    el('p', { class: 'help-note', text: t('help.note') }),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}
