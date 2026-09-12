import { el, clear, mount, svgIcon, focusFirstIn } from './dom.js';
import { seededRandom, sketchCircle, sketchFace, sketchPlane, sketchSvg } from './sketch.js';
import { GRADING_SCALES } from './grading.js';
import * as api from './api.js';
import { iconPaths } from './icons.js';
import { state, closeOverlay, refresh, doLogout, setTab, openOverlay, openSubDetail, detailGoBack, nextTempId, optimisticInsert, setConfig, resetConfig, notify, addCalendarReminder, openCompose, openReminderForm } from './state.js';
import { tabs, TAB_IDS, moodLabels, detailFields, commandLabels, filterLabels, fieldDisplay, classSections, renderItemBody, orderedTabIds, submissionForAssessment } from './rows.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';
import { t, LOCALES, getLocale, setLocale } from './i18n.js';

const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');
const detailPanel = document.getElementById('detail-panel');
const shellEl = document.getElementById('shell');
let detailMobileBackdrop = null;

// `action` (optional: { label, onClick }) adds a button to the toast — e.g.
// "Undo" on a destructive-but-recoverable action — so the toast doubles as
// the confirmation and the recovery path instead of needing a separate
// "are you sure?" dialog before the action happens.
export function showToast(text, kind = 'ok', action = null, { flourish = null } = {}) {
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  };
  // Notebook style's "passing a note": a paper plane draws itself in on the
  // toast, then flies off it.
  const plane = flourish === 'plane' && state.config.style === 'notebook'
    ? sketchSvg(sketchPlane(seededRandom('toast-plane')), { viewBox: [40, 28], draw: true, className: 'sketch-plane' })
    : null;
  const node = el('div', { class: `toast ${kind}${plane ? ' toast-with-plane' : ''}` }, [
    plane,
    el('span', { class: 'toast-text', text }),
    action ? el('button', { class: 'toast-action', type: 'button', onclick: () => { dismiss(); action.onClick(); } }, action.label) : null,
  ]);
  toastRoot.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(dismiss, action ? 5000 : 3200);
}

// Signed URLs expire in an hour and are single-use-ish (Supabase reissues
// them fine, but they're not meant to be stashed) — so this is requested
// fresh on every click rather than cached on the file row.
export async function downloadFileUpload(f, triggerBtn) {
  const original = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = t('detail.downloadPreparing');
  }
  try {
    const url = await api.getSignedFileUrl(f.storage_path);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    showToast(t('detail.downloadFailed', { msg: err.message }), 'bad');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = original;
    }
  }
}

// Per-question answers are fetched lazily (one submission at a time, on
// first view) rather than bulk-loaded into state.data like everything
// else — there's no list of them anywhere else in the UI to justify
// preloading, and re-fetching on every refresh() would be wasted requests
// for a detail panel that's usually closed.
const assessmentAnswersCache = new Map();
const assessmentAnswersLoading = new Set();

function loadAssessmentAnswers(submissionId) {
  if (assessmentAnswersCache.has(submissionId) || assessmentAnswersLoading.has(submissionId)) return;
  assessmentAnswersLoading.add(submissionId);
  api
    .getAssessmentAnswers(submissionId)
    .then((rows) => assessmentAnswersCache.set(submissionId, rows))
    .catch((err) => assessmentAnswersCache.set(submissionId, { error: err.message }))
    .finally(() => {
      assessmentAnswersLoading.delete(submissionId);
      notify();
    });
}

function buildAssessmentAnswers(submissionId) {
  loadAssessmentAnswers(submissionId);
  const cached = assessmentAnswersCache.get(submissionId);
  const section = el('div', { class: 'detail-section' }, [el('div', { class: 'row-section' }, t('detail.yourAnswers'))]);

  if (!cached) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.loading') }));
  } else if (cached.error) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.answersFailed', { msg: cached.error }) }));
  } else if (cached.length === 0) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.noAnswers') }));
  } else {
    // Question text/options aren't shown because they aren't readable —
    // meraki-web only ever sees its own past responses, never the bank of
    // questions, so this is a scored answer log, not a quiz review.
    const rows = cached.map((a, i) => {
      const choice = a.response?.choice;
      const status = a.is_correct === true ? 'good' : a.is_correct === false ? 'bad' : 'dim';
      const statusText = a.is_correct === true ? t('detail.correct') : a.is_correct === false ? t('detail.incorrect') : t('detail.notGraded');
      const meta = [choice != null ? t('detail.chose', { n: choice + 1 }) : null, a.points_awarded != null ? `${a.points_awarded} ${t('unit.pts')}` : null]
        .filter(Boolean)
        .join(' · ');
      return el('div', { class: 'roster-row' }, [
        el('span', { class: 'roster-name', text: t('detail.question', { n: i + 1 }) }),
        el('span', { class: `pill ${status}`, text: statusText }),
        el('span', { class: 'roster-meta', text: meta }),
      ]);
    });
    section.appendChild(el('div', { class: 'roster-list' }, rows));
  }
  return section;
}

function backdrop(onClose) {
  return el('div', { class: 'overlay-backdrop', onclick: onClose });
}

/** Shared language <select> — used on the (pre-auth) login screen and in
 * the toolbar once signed in, so the language picker itself never needs a
 * user to be logged in to be reachable. */
export function buildLanguageSwitcher(extraClass = '') {
  const select = el(
    'select',
    {
      class: `lang-switcher ${extraClass}`,
      'aria-label': t('toolbar.language'),
      title: t('toolbar.language'),
      onchange: (e) => setLocale(e.target.value),
    },
    LOCALES.map((l) => el('option', { value: l.code, selected: l.code === getLocale() || undefined }, l.label)),
  );
  return select;
}

/** Flicking the login sticky note swings it from its tape (.is-swinging in
 * styles.css). Clicks mid-swing are ignored rather than restarting it, which
 * would snap the note back to rest first; so is the click that ends a text
 * selection, so the note doesn't jerk away from someone copying it. */
function swingNote(note) {
  if (note.classList.contains('is-swinging') || String(window.getSelection())) return;
  note.classList.add('is-swinging');
}

function settleNote(e) {
  if (e.animationName === 'note-swing') e.currentTarget.classList.remove('is-swinging');
}

export function mountLogin(root, onLoggedIn) {
  const emailInput = el('input', { type: 'text', name: 'email', autocomplete: 'username', required: true, placeholder: t('login.emailPlaceholder') });
  const passwordInput = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: t('login.submit') });

  const form = el(
    'form',
    {
      class: 'login-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorLine.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = t('login.loggingIn');
        try {
          await api.login(emailInput.value.trim(), passwordInput.value);
          onLoggedIn();
        } catch (err) {
          errorLine.textContent = /login failed/i.test(err.message)
            ? t('login.wrongCreds')
            : t('login.unreachable');
          errorLine.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = t('login.submit');
        }
      },
    },
    [
      el('label', { class: 'field-label', text: t('login.email') }),
      emailInput,
      el('label', { class: 'field-label', text: t('login.password') }),
      passwordInput,
      errorLine,
      submitBtn,
    ],
  );

  mount(
    root,
    el('div', { class: 'login-screen' }, [
      buildLanguageSwitcher('login-lang-switcher'),
      el('div', { class: 'login-card' }, [
        el('h1', { class: 'brand', text: t('brand') }),
        el('p', { class: 'login-sub', text: t('login.subtitle') }),
        form,
      ]),
      el('div', { class: 'sticky-note', role: 'note', onclick: (e) => swingNote(e.currentTarget), onanimationend: settleNote }, [
        el('p', { class: 'sticky-note-title', text: t('login.noteTitle') }),
        el('p', { class: 'sticky-note-body', text: t('login.noteBody') }),
      ]),
    ]),
  );
  emailInput.focus();
}

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
    case 'help':
      overlayRoot.appendChild(buildHelp());
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
  if (justOpened && ['checkin', 'help', 'settings'].includes(current)) {
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
  if (state.detailBackStack.length > 0) {
    headerLeft.push(el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('detail.back'), onclick: detailGoBack }, [svgIcon(iconPaths('back'))]));
  }
  headerLeft.push(el('h2', { text: fieldDisplay(title) }));

  detailPanel.appendChild(el('div', { class: 'panel-header' }, [el('div', { class: 'panel-header-left' }, headerLeft), closeButton()]));
  detailPanel.appendChild(el('div', { class: 'detail-fields' }, fieldNodes));
  if (bodyNode) detailPanel.appendChild(bodyNode);
  if (target.kind === 'fileUpload') {
    const f = state.data.fileUploads[target.index];
    const downloadBtn = el('button', { class: 'btn btn-primary', type: 'button', text: t('detail.download') });
    downloadBtn.addEventListener('click', () => downloadFileUpload(f, downloadBtn));
    detailPanel.appendChild(el('div', { class: 'panel-actions' }, [downloadBtn]));
  }
  if (target.kind === 'class') detailPanel.appendChild(buildClassSections(target.index));
  if (target.kind === 'assessment') {
    const a = state.data.assessments[target.index];
    const sub = submissionForAssessment(state.data, a);
    if (sub) detailPanel.appendChild(buildAssessmentAnswers(sub.id));
  }

  if (!detailMobileBackdrop) {
    detailMobileBackdrop = el('div', { class: 'detail-backdrop', onclick: closeOverlay });
    document.body.appendChild(detailMobileBackdrop);
  }

  detailPanel.scrollTop = savedScrollTop;
  if (isNewTarget) queueMicrotask(() => focusFirstIn(detailPanel));
}

function commands() {
  const runs = [
    ...tabs().map((tb) => () => setTab(tb.id)),
    () => refresh(),
    () => openOverlay('settings'),
    () => doLogout(),
    () => openCompose(),
    () => openOverlay('checkin'),
    () => openReminderForm(),
  ];
  const labels = [...commandLabels(), t('compose.title'), t('checkin.title'), t('calendar.addReminder')];
  return labels.map((label, i) => ({ label, run: runs[i] }));
}

function buildPalette() {
  let query = '';
  let selected = 0;
  const all = commands();

  const list = el('div', { class: 'palette-list' });
  const input = el('input', { class: 'palette-input', type: 'text', placeholder: t('palette.placeholder') });

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
    if (items.length === 0) list.appendChild(el('div', { class: 'palette-empty', text: t('palette.empty') }));
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
  const panel = el('div', { class: 'palette-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.label') }, [input, list]);
  const wrap = el('div', { class: 'overlay-center' }, [backdrop(closeOverlay), panel]);
  queueMicrotask(() => input.focus());
  return wrap;
}

function recipientOptions() {
  const seen = new Set([state.ownUserId]);
  const recipients = [{ id: state.ownUserId, name: t('field.myself') }];
  for (const c of state.data.classes) {
    if (c.teacher_id && !seen.has(c.teacher_id)) {
      seen.add(c.teacher_id);
      recipients.push({ id: c.teacher_id, name: c.teacher_name || t('field.unknown') });
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
  const subject = el('input', { class: 'field-input', type: 'text', maxlength: 200, placeholder: t('compose.subject'), value: prefill?.subject || undefined });
  const body = el('textarea', { class: 'field-input textarea', rows: 6, placeholder: t('compose.messagePlaceholder') });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: t('compose.send') });

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
        showToast(t('compose.sent'), 'ok', null, { flourish: 'plane' });
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
          (err) => showToast(t('compose.sendFailed', { msg: err.message }), 'bad'),
        );
      },
    },
    [
      el('label', { class: 'field-label', text: t('compose.to') }),
      select,
      el('label', { class: 'field-label', text: t('compose.subject') }),
      subject,
      el('label', { class: 'field-label', text: t('compose.message') }),
      body,
      el('div', { class: 'panel-actions' }, [el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: t('compose.cancel') }), sendBtn]),
    ],
  );

  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('compose.title') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('compose.title') }), closeButton()]),
    recipients.length === 0
      ? el('p', { class: 'form-error', text: t('compose.noTeachers') })
      : form,
  ]);
  const wrap = el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
  queueMicrotask(() => (prefill?.subject ? body : subject).focus());
  return wrap;
}

function buildCheckin() {
  let mood = 3;
  const moodRow = el('div', { class: 'mood-row' });
  const note = el('textarea', { class: 'field-input textarea', rows: 4, placeholder: t('checkin.notePlaceholder') });
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: t('checkin.submit') });

  function drawMood() {
    clear(moodRow);
    const notebook = state.config.style === 'notebook';
    moodLabels().forEach((label, i) => {
      const value = i + 1;
      const chosen = value === mood;
      // Notebook style: a doodled face per mood, and the chosen one circled
      // in blue ink. The row is rebuilt on every pick, so the circle draws in
      // exactly when a mood gets chosen.
      const doodles = notebook
        ? [
            sketchSvg(sketchFace(value, seededRandom(`mood-face:${value}`)), { viewBox: [40, 40], className: 'sketch-face' }),
            chosen ? sketchSvg([sketchCircle(25, 22, 22, 20, seededRandom(`mood-pick:${value}`))], { viewBox: [50, 44], draw: true, className: 'sketch-mood-pick' }) : null,
          ]
        : [];
      moodRow.appendChild(
        el(
          'button',
          {
            type: 'button',
            class: `mood-btn ${chosen ? 'active' : ''}`,
            onclick: () => {
              mood = value;
              drawMood();
            },
          },
          [...doodles, label],
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
          errorLine.textContent = t('checkin.noStudentRecord');
          errorLine.hidden = false;
          return;
        }
        const moodVal = mood;
        const noteVal = note.value || null;
        const dateVal = new Date().toISOString().slice(0, 10);

        // Optimistic: close and confirm immediately, reconcile in the
        // background — see optimisticInsert in state.js.
        closeOverlay();
        showToast(t('checkin.checkedIn'));
        const row = { id: nextTempId(), mood: moodVal, note: noteVal, date: dateVal };
        optimisticInsert('checkins', row, 'checkins', { student_id: state.ownStudentId, mood: moodVal, note: noteVal, date: dateVal }).catch(
          (err) => showToast(t('checkin.failed', { msg: err.message }), 'bad'),
        );
      },
    },
    [
      el('label', { class: 'field-label', text: t('checkin.howAreYou') }),
      moodRow,
      el('label', { class: 'field-label', text: t('checkin.note') }),
      note,
      errorLine,
      el('div', { class: 'panel-actions' }, [el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: t('checkin.cancel') }), submitBtn]),
    ],
  );

  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('checkin.title') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('checkin.title') }), closeButton()]),
    form,
  ]);
  const wrap = el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
  return wrap;
}

// Personal reminders are local-only (see addCalendarReminder in state.js) —
// there's no calendar-write API, so this just writes to localStorage and
// closes immediately rather than going through optimisticInsert's
// insert-then-reconcile flow.
function buildReminder() {
  const prefillDate = state.reminderPrefill || new Date().toISOString().slice(0, 10);
  const title = el('input', { class: 'field-input', type: 'text', placeholder: t('reminder.titlePlaceholder'), required: true, maxlength: 120 });
  const date = el('input', { class: 'field-input', type: 'date', value: prefillDate, required: true });
  const note = el('textarea', { class: 'field-input textarea', rows: 3, placeholder: t('reminder.notePlaceholder') });
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        const titleVal = title.value.trim();
        if (!titleVal || !date.value) {
          errorLine.textContent = t('reminder.missingFields');
          errorLine.hidden = false;
          return;
        }
        addCalendarReminder({ title: titleVal, date: date.value, note: note.value.trim() || null });
        closeOverlay();
        showToast(t('reminder.added'));
      },
    },
    [
      el('label', { class: 'field-label', text: t('reminder.title') }),
      title,
      el('label', { class: 'field-label', text: t('label.date') }),
      date,
      el('label', { class: 'field-label', text: t('label.note') }),
      note,
      errorLine,
      el('div', { class: 'panel-actions' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: t('reminder.cancel') }),
        el('button', { class: 'btn btn-primary', type: 'submit', text: t('reminder.save') }),
      ]),
    ],
  );

  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('reminder.addTitle') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('reminder.addTitle') }), closeButton()]),
    form,
  ]);
  const wrap = el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
  queueMicrotask(() => title.focus());
  return wrap;
}

function closeButton() {
  return el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('detail.close'), onclick: closeOverlay }, [svgIcon(iconPaths('close'))]);
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
    classSubSection(t('class.assignments'), s.assignments, 'assignment', t('class.noAssignments')),
    classSubSection(t('class.assessments'), s.assessments, 'assessment', t('class.noAssessments')),
    classSubSection(t('class.discussions'), s.discussions, 'discussion', t('class.noDiscussions')),
    classSubSection(t('class.files'), s.files, 'fileUpload', t('class.noFiles')),
    el('div', { class: 'detail-section' }, [
      el('div', { class: 'row-section' }, t('class.roster')),
      roster.length
        ? el(
            'div',
            { class: 'roster-list' },
            roster.map((e) =>
              el('div', { class: 'roster-row' }, [
                el('span', { class: 'roster-name', text: `${e.students?.first_name ?? ''} ${e.students?.last_name ?? ''}`.trim() || t('field.noData') }),
                el('span', { class: 'roster-meta', text: e.students?.grade_level != null ? t('class.gradeLevel', { n: e.students.grade_level }) : '' }),
              ]),
            ),
          )
        : el('div', { class: 'row-placeholder', text: t('class.noRoster') }),
    ]),
  ]);
}

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

function buildSettings() {
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
    ]),
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
        segmented(
          tabs().map((tb) => [tb.id, tb.title]),
          cfg.defaultTab,
          (v) => setConfig({ defaultTab: v }),
        ),
        el('div', { class: 'settings-tab-list' }, order.map((id, i) => tabRow(id, i, order.length))),
      ],
    ),
    el('div', { class: 'panel-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => resetConfig(), text: t('settings.resetDefaults') }),
    ]),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}

function buildHelp() {
  const rows = [
    ['j / ↓, k / ↑', t('help.moveSelection')],
    ['Enter', t('help.openDetail')],
    ['Tab / Shift+Tab', t('help.switchTab')],
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
