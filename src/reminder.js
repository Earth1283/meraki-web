// The add-a-personal-reminder dialog.
import { el } from './dom.js';
import { state, closeOverlay, addCalendarReminder } from './state.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { backdrop, closeButton } from './panels.js';
import { isoOf } from './calendar.js';

// Personal reminders are local-only (see addCalendarReminder in state.js) —
// there's no calendar-write API, so this just writes to localStorage and
// closes immediately rather than going through optimisticInsert's
// insert-then-reconcile flow.
export function buildReminder() {
  const prefillDate = state.reminderPrefill || isoOf(new Date());
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
