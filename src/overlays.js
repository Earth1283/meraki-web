import { el, clear, svgIcon, focusFirstIn } from './dom.js';
import { iconPaths } from './icons.js';
import { state, closeOverlay, detailGoBack } from './state.js';
import { detailFields, fieldDisplay } from './rows.js';
import { buildPalette } from './palette.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';
import { t } from './i18n.js';
import { closeButton } from './panels.js';
import { downloadFileUpload } from './files.js';
import { detailSections } from './detail-sections.js';
import { buildClassSections } from './classsections.js';
import { buildCompose } from './compose.js';
import { buildCheckin } from './checkin.js';
import { buildReminder } from './reminder.js';
import { buildPortfolioForm } from './portfolio.js';
import { buildTurnInForm } from './turnin.js';
import { buildTakeQuizForm } from './quiztake.js';
import { buildResources } from './resources.js';
import { buildSettings } from './settings.js';
import { buildHelp } from './help.js';

export { mountLogin } from './login.js';

const overlayRoot = document.getElementById('overlay-root');
const detailPanel = document.getElementById('detail-panel');
const shellEl = document.getElementById('shell');
let detailMobileBackdrop = null;

// Tracks the last modal overlay type ('detail' doesn't count — it's a real
// panel, not a dialog, see renderDetailPanel below) so a genuine open/close
// transition can be told apart from a same-overlay re-render (e.g. a
// background auto-refresh firing while compose is open). That distinction
// is what lets focus move into a freshly-opened dialog and back to whatever
// triggered it on close, without re-stealing focus out of a field the user
// is mid-typing in.
let lastModalOverlay = null;
let modalReturnFocus = null;

export function renderOverlay() {
  const current = state.activeOverlay;
  const isModal = current && current !== 'detail';
  const justOpened = isModal && lastModalOverlay !== current;
  if (justOpened) modalReturnFocus = document.activeElement;

  clear(overlayRoot);
  switch (current) {
    case 'palette':
      overlayRoot.appendChild(buildPalette());
      break;
    case 'compose':
      overlayRoot.appendChild(buildCompose());
      break;
    case 'checkin':
      overlayRoot.appendChild(buildCheckin());
      break;
    case 'reminder':
      overlayRoot.appendChild(buildReminder());
      break;
    case 'portfolio':
      overlayRoot.appendChild(buildPortfolioForm());
      break;
    case 'turnin':
      overlayRoot.appendChild(buildTurnInForm());
      break;
    case 'quiz':
      overlayRoot.appendChild(buildTakeQuizForm());
      break;
    case 'help':
      overlayRoot.appendChild(buildHelp());
      break;
    case 'resources':
      overlayRoot.appendChild(buildResources());
      break;
    case 'settings':
      overlayRoot.appendChild(buildSettings());
      break;
    default:
      break;
  }

  // palette/compose already move focus to a specific field of their own on
  // every build (see their own queueMicrotask calls) — checkin/help/settings
  // didn't have any, so they fall back to "first focusable" here. Gated on
  // justOpened so a settings change (which re-renders the same 'settings'
  // overlay via setConfig -> notify()) doesn't yank focus back to the top
  // every time.
  if (justOpened && ['checkin', 'help', 'resources', 'settings', 'quiz'].includes(current)) {
    queueMicrotask(() => focusFirstIn(overlayRoot));
  }

  if (!isModal && lastModalOverlay) {
    if (modalReturnFocus && document.contains(modalReturnFocus) && modalReturnFocus !== document.body) modalReturnFocus.focus();
    modalReturnFocus = null;
  }
  lastModalOverlay = isModal ? current : null;
}

/** Unlike the other overlays, the detail view is opened on every row click —
 * it's browsing, not a deliberate action — so it lives in the shell's own
 * grid as a real column (Gmail/Superhuman-style master-detail) instead of a
 * modal dimming the whole app. Only on narrow screens, where there's no room
 * for a third column, does it fall back to a full-screen sheet (see the
 * mobile media query in styles.css) with its own small backdrop. */
// Same target -> same JSON key: lets a re-render triggered by a background
// refresh (target unchanged) be told apart from an actual navigation to a
// different item (new target), so scroll position only resets on the latter
// and focus only jumps in on the latter too.
let lastDetailTargetKey = null;

export function renderDetailPanel() {
  const isOpen = state.activeOverlay === 'detail';
  shellEl.classList.toggle('detail-open', isOpen);
  detailPanel.hidden = !isOpen;

  if (!isOpen) {
    clear(detailPanel);
    lastDetailTargetKey = null;
    if (detailMobileBackdrop) {
      detailMobileBackdrop.remove();
      detailMobileBackdrop = null;
    }
    return;
  }

  const target = state.detailTarget;
  const targetKey = JSON.stringify(target);
  const isNewTarget = targetKey !== lastDetailTargetKey;
  const savedScrollTop = isNewTarget ? 0 : detailPanel.scrollTop;
  lastDetailTargetKey = targetKey;
  clear(detailPanel);
  const { title, fields, body } = detailFields(target, state.data);
  const fieldNodes = fields.filter(([, value]) => value !== '' && value != null).map(([label, value]) => {
    const display = fieldDisplay(value);
    const empty = display === 'No data';
    return el('div', { class: 'detail-field' }, [
      el('span', { class: 'detail-field-label', text: label }),
      el('span', { class: `detail-field-value ${empty ? 'empty' : ''}`, text: display }),
    ]);
  });

  let bodyNode = null;
  if (body !== undefined && body !== null && body !== '') {
    const display = fieldDisplay(body);
    bodyNode = el('p', { class: `detail-body ${display === 'No data' ? 'empty' : ''}`, text: display });
  }

  const headerLeft = [];
  if (state.detailBackStack.length > 0) {
    headerLeft.push(el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('detail.back'), onclick: detailGoBack }, [svgIcon(iconPaths('back'))]));
  }
  headerLeft.push(el('h2', { text: fieldDisplay(title) }));

  const detailMenu = el('button', {
    class: 'btn-icon',
    type: 'button',
    'aria-label': t('menu.moreActions'),
    title: t('menu.moreActions'),
    onclick: (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(rect.right, rect.bottom, menuItemsFor(target));
    },
  }, [svgIcon(iconPaths('more'))]);
  detailPanel.appendChild(el('div', { class: 'panel-header' }, [
    el('div', { class: 'panel-header-left' }, headerLeft),
    el('div', { class: 'panel-header-actions' }, [detailMenu, closeButton()]),
  ]));
  detailPanel.appendChild(el('div', { class: 'detail-fields' }, fieldNodes));
  if (bodyNode) detailPanel.appendChild(bodyNode);
  if (target.kind === 'fileUpload') {
    const f = state.data.fileUploads[target.index];
    const downloadBtn = el('button', { class: 'btn btn-primary', type: 'button', text: t('detail.download') });
    downloadBtn.addEventListener('click', () => downloadFileUpload(f, downloadBtn));
    detailPanel.appendChild(el('div', { class: 'panel-actions' }, [downloadBtn]));
  }
  if (target.kind === 'class') detailPanel.appendChild(buildClassSections(target.index));
  for (const section of detailSections(target)) detailPanel.appendChild(section);

  if (!detailMobileBackdrop) {
    detailMobileBackdrop = el('div', { class: 'detail-backdrop', onclick: closeOverlay });
    document.body.appendChild(detailMobileBackdrop);
  }

  detailPanel.scrollTop = savedScrollTop;
  if (isNewTarget) queueMicrotask(() => focusFirstIn(detailPanel));
}
