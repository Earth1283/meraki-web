import * as api from './api.js';
import { state, nextTempId, optimisticInsert } from './state.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

/** Sends a message the optimistic way (see optimisticInsert) and then, when
 * `notifyRecipient` is set, asks Meraki's app to notify the recipient as the
 * official site does after every send. The notification is its own call that
 * can fail by itself, so it reports through its own toast. */
export function sendMessage({ recipientId, subject, body, notifyRecipient = false }) {
  const row = { id: nextTempId(), subject, body, created_at: new Date().toISOString(), read: true, sender_id: state.ownUserId, recipient_id: recipientId };
  const apiBody = { sender_id: state.ownUserId, recipient_id: recipientId, subject, body };
  optimisticInsert('messages', row, 'messages', apiBody, { returnId: notifyRecipient }).then(
    (id) => {
      if (!notifyRecipient || !id) return;
      api.notifyMessageRecipient(id).then(
        (sent) => showToast(sent ? t('compose.notified') : t('compose.notifyNotSent'), sent ? 'ok' : 'bad'),
        (err) => showToast(t('compose.notifyFailed', { msg: err.message }), 'bad'),
      );
    },
    (err) => showToast(t('compose.sendFailed', { msg: err.message }), 'bad'),
  );
}
