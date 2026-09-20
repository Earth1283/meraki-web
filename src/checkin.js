// The mood check-in dialog.
import { el, clear } from './dom.js';
import { seededRandom, sketchCircle, sketchFace, sketchSvg } from './sketch.js';
import { state, closeOverlay, nextTempId, optimisticInsert } from './state.js';
import { moodLabels } from './rows.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { backdrop, closeButton } from './panels.js';
import { isoOf } from './calendar.js';

export function buildCheckin() {
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
        const dateVal = isoOf(new Date());

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
