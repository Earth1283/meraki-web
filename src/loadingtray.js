import { el, clear, svgIcon } from './dom.js';
import { state } from './state.js';
import { t } from './i18n.js';
import { iconPaths } from './icons.js';

const root = document.getElementById('loading-tray-root');

// How long the "√ Done" state sits before the tray fades/slides away.
const HOLD_MS = 1250;
const LEAVE_MS = 200;

let trayEl = null;
let iconSlot = null;
let labelEl = null;
let fillEl = null;
let phase = 'hidden'; // 'hidden' | 'loading' | 'done' | 'leaving'
let holdTimer = null;
let leaveTimer = null;

function activeStep() {
  return state.loadingSteps.find((s) => s.status === 'active') ?? state.loadingSteps.find((s) => s.status === 'pending');
}

function buildTray() {
  iconSlot = el('span', { class: 'tray-icon' }, [el('span', { class: 'spinner spinner-sm' })]);
  labelEl = el('span', { class: 'tray-label' });
  fillEl = el('div', { class: 'tray-progress-fill' });
  trayEl = el('div', { class: 'loading-tray' }, [
    el('div', { class: 'tray-row' }, [iconSlot, labelEl]),
    el('div', { class: 'tray-progress' }, [fillEl]),
  ]);
  root.appendChild(trayEl);
  requestAnimationFrame(() => trayEl.classList.add('in'));
}

function updateLoading() {
  const step = activeStep();
  labelEl.textContent = step ? t(step.labelKey) : t('loading.tray.title');
  const doneCount = state.loadingSteps.filter((s) => s.status === 'done').length;
  fillEl.style.width = `${(doneCount / state.loadingSteps.length) * 100}%`;
}

function morphToDone() {
  clear(iconSlot);
  iconSlot.appendChild(svgIcon(iconPaths('check')));
  trayEl.classList.add('done');
  labelEl.textContent = t('loading.tray.done');
  fillEl.style.width = '100%';
}

function leave() {
  phase = 'leaving';
  trayEl.classList.remove('in');
  const node = trayEl;
  leaveTimer = setTimeout(() => node.remove(), LEAVE_MS);
}

function reset() {
  clearTimeout(holdTimer);
  clearTimeout(leaveTimer);
  if (trayEl) trayEl.remove();
  trayEl = null;
  iconSlot = null;
  labelEl = null;
  fillEl = null;
  phase = 'hidden';
}

/** The bottom-right counterpart to the full-screen loading checklist: once
 * 'core' is in, refresh() flips state.loading off and this takes over,
 * showing the remaining step groups without blocking the rest of the UI.
 * When they finish it morphs into a checkmark, holds for HOLD_MS so the
 * "done" state actually registers, then fades/slides out on its own —
 * state.backgroundLoading has already gone back to false by then, so this
 * exit sequence runs entirely off local phase/timers, not state. */
export function renderLoadingTray() {
  if (state.backgroundLoading) {
    if (phase === 'done' || phase === 'leaving') reset();
    if (phase === 'hidden') {
      buildTray();
      phase = 'loading';
    }
    updateLoading();
    return;
  }
  if (phase === 'loading') {
    morphToDone();
    phase = 'done';
    holdTimer = setTimeout(leave, HOLD_MS);
  }
}
