// The settings dialog.
import { el, svgIcon } from './dom.js';
import { GRADING_SCALES } from './grading.js';
import { iconPaths } from './icons.js';
import { state, closeOverlay, setConfig, resetConfig, restoreConfig } from './state.js';
import { tabs, TAB_IDS, orderedTabIds } from './rows.js';
import { buildLanguageSwitcher } from './login.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { backdrop, closeButton } from './panels.js';

// Highlighter colors — keep in sync with the :root.accent-* --hl values in
// styles.css.
const ACCENTS = [
  ['yellow', '#ffe45e'],
  ['green', '#b5f09b'],
  ['blue', '#a8dcff'],
  ['purple', '#d8c5ff'],
  ['red', '#ffb4a8'],
  ['orange', '#ffc78a'],
  ['pink', '#ffb8dc'],
];

function autoRefreshOptions() {
  return [
    [0, t('settings.autoRefresh.off')],
    [30000, '30s'],
    [60000, '1m'],
    [300000, '5m'],
  ];
}

function segmented(options, value, onPick) {
  return el(
    'div',
    { class: 'segmented', role: 'radiogroup' },
    options.map(([val, label]) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: `segmented-item ${value === val ? 'active' : ''}`,
          'aria-pressed': value === val,
          'aria-checked': value === val,
          onclick: () => onPick(val),
        },
        label,
      ),
    ),
  );
}

function settingsSection(title, hint, children, open = false) {
  const kids = [el('summary', { class: 'settings-section-title', text: title })];
  if (hint) kids.push(el('p', { class: 'settings-hint', text: hint }));
  kids.push(...children);
  return el('details', { class: 'settings-section', open }, kids);
}

function accentPicker() {
  return el(
    'div',
    { class: 'accent-row' },
    ACCENTS.map(([id, hex]) => {
      const label = t(`settings.accent.${id}`);
      return el('button', {
        type: 'button',
        class: `accent-option ${state.config.accent === id ? 'active' : ''}`,
        'aria-pressed': state.config.accent === id,
        onclick: () => setConfig({ accent: id }),
      }, [el('span', { class: 'accent-swatch', style: `--swatch:${hex}` }), el('span', { text: label })]);
    }),
  );
}

function moveTab(id, dir) {
  const order = orderedTabIds(state.config);
  const i = order.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  setConfig({ tabOrder: order });
}

function reorderTab(draggedId, beforeId) {
  const order = orderedTabIds(state.config).filter((x) => x !== draggedId);
  const target = beforeId === draggedId ? null : order.indexOf(beforeId);
  order.splice(target === -1 || target === null ? order.length : target, 0, draggedId);
  setConfig({ tabOrder: order });
}

function toggleTabVisible(id) {
  const hidden = new Set(state.config.hiddenTabs);
  if (hidden.has(id)) {
    hidden.delete(id);
  } else {
    if (TAB_IDS.length - hidden.size <= 1) {
      showToast(t('settings.atLeastOneTab'), 'bad');
      return;
    }
    hidden.add(id);
  }
  setConfig({ hiddenTabs: [...hidden] });
}

function tabRow(id, index, total) {
  const tb = tabs().find((x) => x.id === id);
  const hidden = state.config.hiddenTabs.includes(id);
  const row = el('div', { class: 'settings-tab-row', draggable: 'true' }, [
    el('span', { class: 'settings-tab-drag', 'aria-hidden': 'true' }, [svgIcon(iconPaths('dragHandle'))]),
    el('span', { class: `settings-tab-name ${hidden ? 'dim' : ''}`, text: tb.title }),
    el('div', { class: 'settings-tab-actions' }, [
      el(
        'button',
        { type: 'button', class: 'btn-icon', disabled: index === 0, 'aria-label': t('settings.moveUp', { name: tb.title }), onclick: () => moveTab(id, -1) },
        [svgIcon(iconPaths('chevronUp'))],
      ),
      el(
        'button',
        { type: 'button', class: 'btn-icon', disabled: index === total - 1, 'aria-label': t('settings.moveDown', { name: tb.title }), onclick: () => moveTab(id, 1) },
        [svgIcon(iconPaths('chevronDown'))],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'btn-icon',
          'aria-label': hidden ? t('settings.show', { name: tb.title }) : t('settings.hide', { name: tb.title }),
          title: hidden ? t('settings.hiddenTitle') : t('settings.visibleTitle'),
          onclick: () => toggleTabVisible(id),
        },
        [svgIcon(iconPaths(hidden ? 'eyeOff' : 'eye'))],
      ),
    ]),
  ]);

  // Native HTML5 drag-and-drop, alongside the up/down buttons above rather
  // than replacing them — buttons stay the only path for keyboard/touch
  // users, drag is a faster path for a mouse doing a big reorder.
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== id) reorderTab(draggedId, id);
  });

  return row;
}

export function buildSettings() {
  const order = orderedTabIds(state.config);
  const cfg = state.config;

  const panel = el('div', { class: 'side-panel settings-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('settings.title') }), closeButton()]),
    settingsSection(t('settings.language'), t('settings.language.hint'), [buildLanguageSwitcher()]),
    settingsSection(t('settings.appearance'), null, [
      el('label', { class: 'field-label', text: t('settings.theme') }),
      segmented(
        [
          ['system', t('settings.theme.system')],
          ['light', t('settings.theme.light')],
          ['dark', t('settings.theme.dark')],
        ],
        cfg.theme,
        (v) => setConfig({ theme: v }),
      ),
      el('label', { class: 'field-label', text: t('settings.accent') }),
      accentPicker(),
      el('label', { class: 'field-label', text: t('settings.density') }),
      segmented(
        [
          ['comfortable', t('settings.density.comfortable')],
          ['compact', t('settings.density.compact')],
        ],
        cfg.density,
        (v) => setConfig({ density: v }),
      ),
      el('label', { class: 'field-label', text: t('settings.style') }),
      segmented(
        [
          ['normal', t('settings.style.normal')],
          ['notebook', t('settings.style.notebook')],
        ],
        cfg.style,
        (v) => setConfig({ style: v }),
      ),
    ], true),
    settingsSection(t('settings.timeAndData'), null, [
      el('label', { class: 'field-label', text: t('settings.clock') }),
      segmented(
        [
          ['12h', t('settings.clock.12h')],
          ['24h', t('settings.clock.24h')],
        ],
        cfg.timeFormat,
        (v) => setConfig({ timeFormat: v }),
      ),
      el('label', { class: 'field-label', text: t('settings.autoRefresh') }),
      segmented(autoRefreshOptions(), cfg.autoRefreshMs, (v) => setConfig({ autoRefreshMs: v })),
    ]),
    settingsSection(t('settings.grades'), t('settings.grades.hint'), [
      el('label', { class: 'field-label', text: t('grade.scale') }),
      segmented(GRADING_SCALES.map((scale) => [scale, t(`grade.scale.${scale}`)]), cfg.gradingScale, (v) => setConfig({ gradingScale: v })),
    ]),
    settingsSection(
      t('settings.navigation'),
      t('settings.navigation.hint'),
      [
        el('label', { class: 'field-label', text: t('settings.defaultTab') }),
        el('select', { class: 'field-input settings-default-tab', onchange: (event) => setConfig({ defaultTab: event.target.value }) },
          tabs().map((tb) => el('option', { value: tb.id, selected: cfg.defaultTab === tb.id }, tb.title))),
        el('div', { class: 'settings-tab-list' }, order.map((id, i) => tabRow(id, i, order.length))),
      ],
    ),
    el('div', { class: 'panel-actions' }, [
      resetButton(),
    ]),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}

function resetButton() {
  let armed = false;
  let armTimer = null;
  const button = el('button', {
    class: 'btn btn-ghost reset-button',
    type: 'button',
    onclick: () => {
      if (!armed) {
        armed = true;
        button.textContent = t('settings.resetConfirm');
        button.classList.add('armed');
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armed = false;
          button.textContent = t('settings.resetDefaults');
          button.classList.remove('armed');
        }, 6900);
        return;
      }
      clearTimeout(armTimer);
      const previous = resetConfig();
      showToast(t('settings.resetDone'), 'ok', {
        label: t('action.undo'),
        onClick: () => restoreConfig(previous),
      }, { duration: 6900 });
    },
    text: t('settings.resetDefaults'),
  });
  return button;
}
