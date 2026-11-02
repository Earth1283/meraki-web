/** The messages in `messages` that are unread, addressed to `ownUserId`, and
 * really on the server (not an optimistic temp row), minus any in `skip`. */
export function unreadIncoming(messages, ownUserId, skip = []) {
  return messages.filter((m) => m.read === false && m.recipient_id === ownUserId && !String(m.id).startsWith('temp-') && !skip.some((s) => s.has(m.id)));
}
