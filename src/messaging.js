import * as api from './api.js';
import { state, nextTempId, optimisticInsert, notify } from './state.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { unreadIncoming } from './unread.js';

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

const markingRead = new Set();
const failedToMark = new Set();

/** Marks the unread messages addressed to you among `messages` as read, the
 * way the official site does when you open them: shown read at once, then
 * PATCHed; a message whose PATCH fails goes back to unread. */
export function markMessagesRead(messages) {
  const unread = unreadIncoming(messages, state.ownUserId, [markingRead, failedToMark]);
  if (unread.length === 0) return;
  for (const m of unread) {
    markingRead.add(m.id);
    m.read = true;
  }
  notify();
  for (const m of unread) {
    api.updateRow('messages', m.id, { read: true }).catch(() => {
      failedToMark.add(m.id);
      m.read = false;
      notify();
    }).finally(() => markingRead.delete(m.id));
  }
}

export function markThreadRead(partnerId) {
  markMessagesRead(state.data.messages.filter((m) => m.sender_id === partnerId));
}
