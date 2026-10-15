import { el } from './dom.js';
import { formatDateTime } from './rows.js';
import { t } from './i18n.js';
import { INVISIBLE_STOPS, DEFAULT_INVISIBLE_STOP, activeInvisible, setInvisible, clearInvisible } from './invisible.js';

// A checkbox that reveals a stepped slider; the choice is read at submit time.
export function buildInvisibleControls() {
  const active = activeInvisible();
  const checkbox = el('input', { id: 'login-invisible', type: 'checkbox', checked: !!active });
  const slider = el('input', {
    id: 'login-invisible-for', class: 'invisible-slider', type: 'range',
    min: 0, max: INVISIBLE_STOPS.length - 1, step: 1, value: active?.stop ?? DEFAULT_INVISIBLE_STOP,
    'aria-label': t('login.invisibleFor'),
  });
  const readout = el('output', { class: 'invisible-readout', for: 'login-invisible-for' });
  const hint = el('p', { class: 'invisible-hint', text: t('login.invisibleHint') });
  const panel = el('div', { class: 'invisible-for' }, [
    el('div', { class: 'invisible-for-row' }, [el('span', { class: 'field-label', text: t('login.invisibleFor') }), readout]),
    slider, hint,
  ]);
  const sync = () => {
    panel.hidden = !checkbox.checked;
    readout.textContent = t(`login.invisible.${INVISIBLE_STOPS[slider.value].id}`);
  };
  checkbox.addEventListener('change', sync);
  slider.addEventListener('input', sync);
  sync();
  return {
    node: el('div', { class: 'invisible-controls' }, [
      el('label', { class: 'check-row', for: 'login-invisible' }, [checkbox, el('span', { text: t('login.invisible') })]),
      panel,
    ]),
    /** Records the choice and says whether this login should skip login_events. */
    commit() {
      if (!checkbox.checked) { clearInvisible(); return false; }
      setInvisible(Number(slider.value));
      return true;
    },
  };
}

// Settings applies each change straight away; the off button only shows while it's on.
export function buildInvisibleSettings() {
  const checkbox = el('input', { id: 'settings-invisible', type: 'checkbox' });
  const slider = el('input', {
    id: 'settings-invisible-for', class: 'invisible-slider', type: 'range',
    min: 0, max: INVISIBLE_STOPS.length - 1, step: 1, 'aria-label': t('login.invisibleFor'),
  });
  const readout = el('output', { class: 'invisible-readout', for: 'settings-invisible-for' });
  const status = el('p', { class: 'invisible-hint', role: 'status', 'aria-live': 'polite' });
  const panel = el('div', { class: 'invisible-for' }, [
    el('div', { class: 'invisible-for-row' }, [el('span', { class: 'field-label', text: t('login.invisibleFor') }), readout]),
    slider, status,
  ]);
  const disable = el('button', { class: 'btn btn-ghost btn-sm invisible-disable', type: 'button', text: t('settings.invisibleDisable') });
  const render = () => {
    const active = activeInvisible();
    checkbox.checked = !!active;
    panel.hidden = !active;
    disable.hidden = !active;
    if (!active) return;
    slider.value = active.stop;
    readout.textContent = t(`login.invisible.${INVISIBLE_STOPS[active.stop].id}`);
    status.textContent = active.until === null ? t('settings.invisibleAlways') : t('settings.invisibleUntil', { when: formatDateTime(new Date(active.until).toISOString()) });
  };
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) setInvisible(Number(slider.value || DEFAULT_INVISIBLE_STOP));
    else clearInvisible();
    render();
  });
  slider.addEventListener('input', () => { setInvisible(Number(slider.value)); render(); });
  disable.addEventListener('click', () => { clearInvisible(); render(); });
  slider.value = DEFAULT_INVISIBLE_STOP;
  render();
  return el('div', { class: 'invisible-controls' }, [
    el('label', { class: 'check-row', for: 'settings-invisible' }, [checkbox, el('span', { text: t('login.invisible') })]),
    panel, disable,
  ]);
}
