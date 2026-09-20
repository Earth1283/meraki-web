// The compose-a-message dialog.
import { el } from './dom.js';
import { state, closeOverlay } from './state.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { backdrop, closeButton } from './panels.js';
import { sendMessage } from './messaging.js';

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

export function buildCompose() {
  const recipients = recipientOptions();
  const prefill = state.composePrefill;
  const select = el(
    'select',
    { id: 'compose-recipient', class: 'field-input', required: true },
    [el('option', { value: '', disabled: true, selected: !prefill?.recipientId, text: t('compose.chooseRecipient') }), ...recipients.map((r) => el('option', { value: r.id, selected: prefill?.recipientId === r.id || undefined }, r.name))],
  );
  const subject = el('input', { id: 'compose-subject', class: 'field-input', type: 'text', maxlength: 200, placeholder: t('compose.subject'), value: prefill?.subject || undefined });
  const body = el('textarea', { id: 'compose-message', class: 'field-input textarea', rows: 6, placeholder: t('compose.messagePlaceholder'), required: true });
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: t('compose.send') });
  // The official site notifies the recipient after every send; here it's a
  // visible choice, on by default. Hidden for notes to yourself.
  const notifyBox = el('input', { type: 'checkbox', checked: true });
  const notifyRow = el('label', { class: 'check-row' }, [notifyBox, el('span', { text: t('compose.notify') })]);
  const syncNotify = () => {
    notifyRow.hidden = !select.value || select.value === state.ownUserId;
  };
  select.addEventListener('change', syncNotify);
  syncNotify();

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        const messageBody = body.value.trim();
        if (!select.value || !messageBody) {
          errorLine.textContent = t('compose.missingFields');
          errorLine.hidden = false;
          return;
        }
        const message = { recipientId: select.value, subject: subject.value.trim(), body: messageBody, notifyRecipient: !notifyRow.hidden && notifyBox.checked };

        // Optimistic: close and confirm immediately, reconcile in the
        // background — see optimisticInsert in state.js.
        closeOverlay();
        showToast(t('compose.sent'), 'ok', null, { flourish: 'plane' });
        sendMessage(message);
      },
    },
    [
      el('label', { class: 'field-label', for: 'compose-recipient', text: t('compose.to') }),
      select,
      el('label', { class: 'field-label', for: 'compose-subject', text: t('compose.subject') }),
      subject,
      el('label', { class: 'field-label', for: 'compose-message', text: t('compose.message') }),
      body,
      notifyRow,
      errorLine,
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
