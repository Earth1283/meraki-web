import { el, clear, mount, svgIcon } from './dom.js';
import * as api from './api.js';
import { iconPaths } from './icons.js';
import { state, closeOverlay, refresh, doLogout, setTab, openOverlay, openSubDetail, detailGoBack, nextTempId, optimisticInsert, setConfig, resetConfig } from './state.js';
import { TABS, MOOD_LABELS, detailFields, commandLabels, filterLabels, fieldDisplay, classSections, renderItemBody, orderedTabIds } from './rows.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';

const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');
const detailPanel = document.getElementById('detail-panel');
const shellEl = document.getElementById('shell');
let detailMobileBackdrop = null;

export function showToast(text, kind = 'ok') {
  const node = el('div', { class: `toast ${kind}`, text });
  toastRoot.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  }, 3200);
}

// Signed URLs expire in an hour and are single-use-ish (Supabase reissues
// them fine, but they're not meant to be stashed) — so this is requested
// fresh on every click rather than cached on the file row.
export async function downloadFileUpload(f, triggerBtn) {
  const original = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Preparing…';
  }
  try {
    const url = await api.getSignedFileUrl(f.storage_path);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    showToast(`Couldn't download: ${err.message}`, 'bad');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = original;
    }
  }
}

function backdrop(onClose) {
  return el('div', { class: 'overlay-backdrop', onclick: onClose });
}

export function mountLogin(root, onLoggedIn) {
  const emailInput = el('input', { type: 'text', name: 'email', autocomplete: 'username', required: true, placeholder: 'you@meraki.local, or just "you"' });
  const passwordInput = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const errorLine = el('p', { class: 'form-error', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Log in' });

  const form = el(
    'form',
    {
      class: 'login-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorLine.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in…';
        try {
          await api.login(emailInput.value.trim(), passwordInput.value);
          onLoggedIn();
        } catch (err) {
          errorLine.textContent = /login failed/i.test(err.message)
            ? 'Wrong email or password.'
            : "Couldn't reach Meraki. Check your connection and try again.";
          errorLine.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Log in';
        }
      },
    },
    [
      el('label', { class: 'field-label', text: 'Email' }),
      emailInput,
      el('label', { class: 'field-label', text: 'Password' }),
      passwordInput,
      errorLine,
      submitBtn,
    ],
  );

  mount(
    root,
    el('div', { class: 'login-screen' }, [
      el('div', { class: 'login-card' }, [
        el('h1', { class: 'brand', text: 'Meraki' }),
        el('p', { class: 'login-sub', text: 'Sign in with your school account.' }),
        form,
      ]),
    ]),
  );
  emailInput.focus();
}

export function renderOverlay() {
  clear(overlayRoot);
  switch (state.activeOverlay) {
    case 'palette':
      overlayRoot.appendChild(buildPalette());
      break;
    case 'compose':
      overlayRoot.appendChild(buildCompose());
      break;
    case 'checkin':
      overlayRoot.appendChild(buildCheckin());
      break;
    case 'help':
      overlayRoot.appendChild(buildHelp());
      break;
    case 'settings':
      overlayRoot.appendChild(buildSettings());
      break;
    default:
      break;
  }
}

/** Unlike the other overlays, the detail view is opened on every row click —
 * it's browsing, not a deliberate action — so it lives in the shell's own
 * grid as a real column (Gmail/Superhuman-style master-detail) instead of a
 * modal dimming the whole app. Only on narrow screens, where there's no room
 * for a third column, does it fall back to a full-screen sheet (see the
 * mobile media query in styles.css) with its own small backdrop. */
export function renderDetailPanel() {
  const isOpen = state.activeOverlay === 'detail';
  shellEl.classList.toggle('detail-open', isOpen);
  detailPanel.hidden = !isOpen;
  clear(detailPanel);

  if (!isOpen) {
    if (detailMobileBackdrop) {
      detailMobileBackdrop.remove();
      detailMobileBackdrop = null;
    }
    return;
  }

  const target = state.detailTarget;
  const { title, fields, body } = detailFields(target, state.data);
  const fieldNodes = fields.map(([label, value]) => {
    const display = fieldDisplay(value);
    const empty = display === 'No data';
    return el('div', { class: 'detail-field' }, [
      el('span', { class: 'detail-field-label', text: label }),
      el('span', { class: `detail-field-value ${empty ? 'empty' : ''}`, text: display }),
    ]);
  });

  let bodyNode = null;
  if (body !== undefined) {
    const display = fieldDisplay(body);
    bodyNode = el('p', { class: `detail-body ${display === 'No data' ? 'empty' : ''}`, text: display });
  }

  const headerLeft = [];
  if (state.detailBack) {
    headerLeft.push(el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Back', onclick: detailGoBack, text: '←' }));
  }
  headerLeft.push(el('h2', { text: fieldDisplay(title) }));

  detailPanel.appendChild(el('div', { class: 'panel-header' }, [el('div', { class: 'panel-header-left' }, headerLeft), closeButton()]));
  detailPanel.appendChild(el('div', { class: 'detail-fields' }, fieldNodes));
  if (bodyNode) detailPanel.appendChild(bodyNode);
  if (target.kind === 'fileUpload') {
    const f = state.data.fileUploads[target.index];
    const downloadBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Download' });
    downloadBtn.addEventListener('click', () => downloadFileUpload(f, downloadBtn));
    detailPanel.appendChild(el('div', { class: 'panel-actions' }, [downloadBtn]));
  }
  if (target.kind === 'class') detailPanel.appendChild(buildClassSections(target.index));

  if (!detailMobileBackdrop) {
    detailMobileBackdrop = el('div', { class: 'detail-backdrop', onclick: closeOverlay });
    document.body.appendChild(detailMobileBackdrop);
  }
}

function commands() {
  const runs = [...TABS.map((t) => () => setTab(t.id)), () => refresh(), () => openOverlay('settings'), () => doLogout()];
  return commandLabels().map((label, i) => ({ label, run: runs[i] }));
}

function buildPalette() {
  let query = '';
  let selected = 0;
  const all = commands();

  const list = el('div', { class: 'palette-list' });
  const input = el('input', { class: 'palette-input', type: 'text', placeholder: 'Type a command…' });

  function matches() {
    const wanted = new Set(filterLabels(all.map((c) => c.label), query));
    return all.filter((c) => wanted.has(c.label));
  }

  function run(cmd) {
    closeOverlay();
    cmd.run();
  }

  function draw() {
    clear(list);
    const items = matches();
    items.forEach((cmd, i) => {
      list.appendChild(
        el('button', { class: `palette-item ${i === selected ? 'active' : ''}`, type: 'button', onclick: () => run(cmd) }, cmd.label),
      );
    });
    if (items.length === 0) list.appendChild(el('div', { class: 'palette-empty', text: 'No matching commands' }));
  }

  input.addEventListener('input', () => {
    query = input.value;
    selected = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    const items = matches();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.min(selected + 1, items.length - 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selected]) run(items[selected]);
    } else if (e.key === 'Escape') {
      closeOverlay();
    }
  });

  draw();
  const panel = el('div', { class: 'palette-panel' }, [input, list]);
  const wrap = el('div', { class: 'overlay-center' }, [backdrop(closeOverlay), panel]);
  queueMicrotask(() => input.focus());
  return wrap;
}

function recipientOptions() {
  const seen = new Set([state.ownUserId]);
  const recipients = [{ id: state.ownUserId, name: 'Myself' }];
  for (const c of state.data.classes) {
    if (c.teacher_id && !seen.has(c.teacher_id)) {
      seen.add(c.teacher_id);
      recipients.push({ id: c.teacher_id, name: c.teacher_name || '(unknown teacher)' });
    }
  }
  return recipients;
}

function buildCompose() {
  const recipients = recipientOptions();
  const prefill = state.composePrefill;
  const select = el(
    'select',
    { class: 'field-input' },
    recipients.map((r) => el('option', { value: r.id, selected: prefill?.recipientId === r.id || undefined }, r.name)),
  );
  const subject = el('input', { class: 'field-input', type: 'text', maxlength: 200, placeholder: 'Subject', value: prefill?.subject || undefined });
  const body = el('textarea', { class: 'field-input textarea', rows: 6, placeholder: 'Write your message…' });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Send message' });

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (recipients.length === 0) return;
        const recipientId = select.value;
        const subjectVal = subject.value;
        const bodyVal = body.value;

        // Optimistic: close and confirm immediately, reconcile in the
        // background — see optimisticInsert in state.js.
        closeOverlay();
        showToast('Message sent');
        const row = {
          id: nextTempId(),
          subject: subjectVal,
          body: bodyVal,
          created_at: new Date().toISOString(),
          read: true,
          sender_id: state.ownUserId,
          recipient_id: recipientId,
        };
        optimisticInsert('messages', row, 'messages', { sender_id: state.ownUserId, recipient_id: recipientId, subject: subjectVal, body: bodyVal }).catch(
          (err) => showToast(`Couldn't send: ${err.message}`, 'bad'),
        );
      },
    },
    [
      el('label', { class: 'field-label', text: 'To' }),
      select,
      el('label', { class: 'field-label', text: 'Subject' }),
      subject,
      el('label', { class: 'field-label', text: 'Message' }),
      body,
      el('div', { class: 'panel-actions' }, [el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: 'Cancel' }), sendBtn]),
    ],
  );

  const panel = el('div', { class: 'side-panel' }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: 'New message' }), closeButton()]),
    recipients.length === 0
      ? el('p', { class: 'form-error', text: 'You have no teachers to message yet — enroll in a class first.' })
      : form,
  ]);
  const wrap = el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
  queueMicrotask(() => (prefill?.subject ? body : subject).focus());
  return wrap;
}

function buildCheckin() {
  let mood = 3;
  const moodRow = el('div', { class: 'mood-row' });
  const note = el('textarea', { class: 'field-input textarea', rows: 4, placeholder: 'Anything you want to add? (optional)' });
  const errorLine = el('p', { class: 'form-error', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Check in' });

  function drawMood() {
    clear(moodRow);
    MOOD_LABELS.forEach((label, i) => {
      const value = i + 1;
      moodRow.appendChild(
        el(
          'button',
          {
            type: 'button',
            class: `mood-btn ${value === mood ? 'active' : ''}`,
            onclick: () => {
              mood = value;
              drawMood();
            },
          },
          label,
        ),
      );
    });
  }
  drawMood();

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (!state.ownStudentId) {
          errorLine.textContent = 'No student record found for this account.';
          errorLine.hidden = false;
          return;
        }
        const moodVal = mood;
        const noteVal = note.value || null;
        const dateVal = new Date().toISOString().slice(0, 10);

        // Optimistic: close and confirm immediately, reconcile in the
        // background — see optimisticInsert in state.js.
        closeOverlay();
        showToast('Checked in');
        const row = { id: nextTempId(), mood: moodVal, note: noteVal, date: dateVal };
        optimisticInsert('checkins', row, 'checkins', { student_id: state.ownStudentId, mood: moodVal, note: noteVal, date: dateVal }).catch(
          (err) => showToast(`Couldn't check in: ${err.message}`, 'bad'),
        );
      },
    },
    [
      el('label', { class: 'field-label', text: 'How are you doing?' }),
      moodRow,
      el('label', { class: 'field-label', text: 'Note' }),
      note,
      errorLine,
      el('div', { class: 'panel-actions' }, [el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: 'Cancel' }), submitBtn]),
    ],
  );

  const panel = el('div', { class: 'side-panel' }, [el('div', { class: 'panel-header' }, [el('h2', { text: 'Check in' }), closeButton()]), form]);
  const wrap = el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
  return wrap;
}

function closeButton() {
  return el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Close', onclick: closeOverlay, text: '✕' });
}

function classSubSection(label, indices, kind, emptyText) {
  const items = indices.map((index) => {
    const target = { kind, index };
    return el(
      'button',
      {
        class: 'row-item compact',
        type: 'button',
        onclick: () => openSubDetail(target),
        oncontextmenu: (e) => {
          e.preventDefault();
          openContextMenu(e.clientX, e.clientY, menuItemsFor(target));
        },
      },
      [renderItemBody(target, state.data, state.ownUserId)],
    );
  });
  return el('div', { class: 'detail-section' }, [
    el('div', { class: 'row-section' }, label),
    items.length ? el('div', { class: 'row-list' }, items) : el('div', { class: 'row-placeholder', text: emptyText }),
  ]);
}

function buildClassSections(classIndex) {
  const c = state.data.classes[classIndex];
  const s = classSections(state.data, c.id);
  const roster = s.roster.map((i) => state.data.enrollments[i]);

  return el('div', { class: 'class-sections' }, [
    classSubSection('Assignments', s.assignments, 'assignment', 'No assignments posted yet.'),
    classSubSection('Assessments', s.assessments, 'assessment', 'No quizzes or tests posted yet.'),
    classSubSection('Discussions', s.discussions, 'discussion', 'No discussions posted yet.'),
    classSubSection('Files', s.files, 'fileUpload', 'No files uploaded yet.'),
    el('div', { class: 'detail-section' }, [
      el('div', { class: 'row-section' }, 'Roster'),
      roster.length
        ? el(
            'div',
            { class: 'roster-list' },
            roster.map((e) =>
              el('div', { class: 'roster-row' }, [
                el('span', { class: 'roster-name', text: `${e.students?.first_name ?? ''} ${e.students?.last_name ?? ''}`.trim() || 'No data' }),
                el('span', { class: 'roster-meta', text: e.students?.grade_level != null ? `Grade ${e.students.grade_level}` : '' }),
              ]),
            ),
          )
        : el('div', { class: 'row-placeholder', text: 'No roster on file.' }),
    ]),
  ]);
}

const ACCENTS = [
  ['blue', '#2563eb'],
  ['green', '#16a34a'],
  ['purple', '#9333ea'],
  ['red', '#dc2626'],
  ['orange', '#d97706'],
  ['pink', '#db2777'],
];

const AUTO_REFRESH_OPTIONS = [
  [0, 'Off'],
  [30000, '30s'],
  [60000, '1m'],
  [300000, '5m'],
];

function segmented(options, value, onPick) {
  return el(
    'div',
    { class: 'segmented' },
    options.map(([val, label]) =>
      el('button', { type: 'button', class: `segmented-item ${value === val ? 'active' : ''}`, onclick: () => onPick(val) }, label),
    ),
  );
}

function settingsSection(title, hint, children) {
  const kids = [el('h3', { class: 'settings-section-title', text: title })];
  if (hint) kids.push(el('p', { class: 'settings-hint', text: hint }));
  kids.push(...children);
  return el('div', { class: 'settings-section' }, kids);
}

function accentPicker() {
  return el(
    'div',
    { class: 'accent-row' },
    ACCENTS.map(([id, hex]) =>
      el('button', {
        type: 'button',
        class: `accent-swatch ${state.config.accent === id ? 'active' : ''}`,
        style: `--swatch:${hex}`,
        'aria-label': `${id} accent`,
        'aria-pressed': state.config.accent === id,
        title: id[0].toUpperCase() + id.slice(1),
        onclick: () => setConfig({ accent: id }),
      }),
    ),
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

function toggleTabVisible(id) {
  const hidden = new Set(state.config.hiddenTabs);
  if (hidden.has(id)) {
    hidden.delete(id);
  } else {
    if (TABS.length - hidden.size <= 1) {
      showToast('At least one tab has to stay visible', 'bad');
      return;
    }
    hidden.add(id);
  }
  setConfig({ hiddenTabs: [...hidden] });
}

function tabRow(id, index, total) {
  const t = TABS.find((x) => x.id === id);
  const hidden = state.config.hiddenTabs.includes(id);
  return el('div', { class: 'settings-tab-row' }, [
    el('span', { class: `settings-tab-name ${hidden ? 'dim' : ''}`, text: t.title }),
    el('div', { class: 'settings-tab-actions' }, [
      el(
        'button',
        { type: 'button', class: 'btn-icon', disabled: index === 0, 'aria-label': `Move ${t.title} up`, onclick: () => moveTab(id, -1) },
        [svgIcon(iconPaths('chevronUp'))],
      ),
      el(
        'button',
        { type: 'button', class: 'btn-icon', disabled: index === total - 1, 'aria-label': `Move ${t.title} down`, onclick: () => moveTab(id, 1) },
        [svgIcon(iconPaths('chevronDown'))],
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'btn-icon',
          'aria-label': hidden ? `Show ${t.title} in sidebar` : `Hide ${t.title} from sidebar`,
          title: hidden ? 'Hidden — click to show' : 'Visible — click to hide',
          onclick: () => toggleTabVisible(id),
        },
        [svgIcon(iconPaths(hidden ? 'eyeOff' : 'eye'))],
      ),
    ]),
  ]);
}

function buildSettings() {
  const order = orderedTabIds(state.config);
  const cfg = state.config;

  const panel = el('div', { class: 'side-panel settings-panel' }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: 'Settings' }), closeButton()]),
    settingsSection('Appearance', null, [
      el('label', { class: 'field-label', text: 'Theme' }),
      segmented(
        [
          ['system', 'System'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        cfg.theme,
        (v) => setConfig({ theme: v }),
      ),
      el('label', { class: 'field-label', text: 'Accent color' }),
      accentPicker(),
      el('label', { class: 'field-label', text: 'Density' }),
      segmented(
        [
          ['comfortable', 'Comfortable'],
          ['compact', 'Compact'],
        ],
        cfg.density,
        (v) => setConfig({ density: v }),
      ),
    ]),
    settingsSection('Time & data', null, [
      el('label', { class: 'field-label', text: 'Clock' }),
      segmented(
        [
          ['12h', '12-hour'],
          ['24h', '24-hour'],
        ],
        cfg.timeFormat,
        (v) => setConfig({ timeFormat: v }),
      ),
      el('label', { class: 'field-label', text: 'Auto-refresh' }),
      segmented(AUTO_REFRESH_OPTIONS, cfg.autoRefreshMs, (v) => setConfig({ autoRefreshMs: v })),
    ]),
    settingsSection(
      'Navigation',
      'Reorder or hide tabs in the sidebar. Hidden tabs stay one keystroke away in the command palette (Ctrl/⌘+P).',
      [
        el('label', { class: 'field-label', text: 'Default tab on login' }),
        segmented(
          TABS.map((t) => [t.id, t.title]),
          cfg.defaultTab,
          (v) => setConfig({ defaultTab: v }),
        ),
        el('div', { class: 'settings-tab-list' }, order.map((id, i) => tabRow(id, i, order.length))),
      ],
    ),
    el('div', { class: 'panel-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => resetConfig(), text: 'Reset to defaults' }),
    ]),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}

function buildHelp() {
  const rows = [
    ['j / ↓, k / ↑', 'Move selection'],
    ['Enter', 'Open detail'],
    ['Tab / Shift+Tab', 'Switch tab'],
    ['Ctrl/⌘+P', 'Command palette'],
    ['n', 'New message (Messages) / Check in (Me)'],
    ['r', 'Refresh'],
    [',', 'Settings'],
    ['?', 'This help'],
  ];
  const panel = el('div', { class: 'side-panel' }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: 'Keyboard shortcuts' }), closeButton()]),
    el(
      'div',
      { class: 'help-rows' },
      rows.map(([k, d]) => el('div', { class: 'help-row' }, [el('kbd', { text: k }), el('span', { text: d })])),
    ),
    el('p', { class: 'help-note', text: 'None of this is required — every action here also works by clicking.' }),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}
