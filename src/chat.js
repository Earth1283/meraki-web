import { el, clear, svgIcon } from './dom.js';
import { state, setActiveThread, nextTempId, optimisticInsert } from './state.js';
import { messageThreads, partnerName, initials, dayKey, formatDaySeparator, formatTime12 } from './rows.js';
import { iconPaths } from './icons.js';
import { showToast } from './overlays.js';
import { t } from './i18n.js';

// Module-level, not per-call: lets us tell "new message arrived" apart from
// "something unrelated re-rendered the page" across separate renderChat()
// calls, since each call rebuilds the DOM (and thus the scroll position)
// from scratch.
let lastThreadId = null;
let lastMessageCount = -1;

export function renderChat(container) {
  clear(container);
  const threads = messageThreads(state.data, state.ownUserId);

  if ((!state.activeThreadPartnerId || !threads.some((t) => t.partnerId === state.activeThreadPartnerId)) && threads.length) {
    state.activeThreadPartnerId = threads[0].partnerId;
  }

  const threadList = el(
    'div',
    { class: 'chat-thread-list' },
    threads.length === 0
      ? [el('div', { class: 'row-placeholder', text: t('chat.noConversations') })]
      : threads.map((t) => {
          const name = partnerName(state.data, state.ownUserId, t.partnerId);
          return el(
            'button',
            {
              class: `chat-thread-item ${t.partnerId === state.activeThreadPartnerId ? 'active' : ''}`,
              type: 'button',
              onclick: () => setActiveThread(t.partnerId),
            },
            [
              el('span', { class: 'chat-avatar', text: initials(name) }),
              el('span', { class: 'chat-thread-name', text: name }),
              t.unread ? el('span', { class: 'chat-unread-dot' }) : null,
            ],
          );
        }),
  );

  const thread = threads.find((t) => t.partnerId === state.activeThreadPartnerId);
  const threadView = el(
    'div',
    { class: 'chat-thread-view' },
    thread ? buildThreadView(thread) : [el('div', { class: 'chat-empty', text: t('chat.pickConversation') })],
  );

  container.appendChild(el('div', { class: 'chat-shell' }, [threadList, threadView]));

  if (thread) {
    const shouldScroll = thread.partnerId !== lastThreadId || thread.indices.length !== lastMessageCount;
    lastThreadId = thread.partnerId;
    lastMessageCount = thread.indices.length;
    if (shouldScroll) {
      const messagesEl = container.querySelector('.chat-messages');
      requestAnimationFrame(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  } else {
    lastThreadId = null;
    lastMessageCount = -1;
  }
}

function buildThreadView(thread) {
  const name = partnerName(state.data, state.ownUserId, thread.partnerId);
  const header = el('div', { class: 'chat-thread-header' }, [
    el('span', { class: 'chat-avatar', text: initials(name) }),
    el('span', { text: name }),
  ]);

  const messages = el('div', { class: 'chat-messages' });
  let lastSender = null;
  let lastDayKey = null;
  for (const idx of thread.indices) {
    const m = state.data.messages[idx];
    const isOwn = m.sender_id === state.ownUserId;
    const author = isOwn ? t('chat.you') : name;

    const dk = dayKey(m.created_at);
    if (dk !== lastDayKey) {
      messages.appendChild(el('div', { class: 'chat-date-sep' }, [el('span', { text: formatDaySeparator(m.created_at) })]));
      lastDayKey = dk;
      lastSender = null; // a new day always starts a fresh group, like Discord
    }
    const grouped = lastSender === m.sender_id;
    lastSender = m.sender_id;

    const bodyLines = [];
    if (m.subject) bodyLines.push(el('div', { class: 'chat-msg-subject', text: m.subject }));
    bodyLines.push(el('div', { class: 'chat-msg-text', text: m.body || t('chat.noMessage') }));

    const gutter = grouped
      ? el('div', { class: 'chat-msg-gutter' }, [el('span', { class: 'chat-msg-hover-time', text: formatTime12(m.created_at, state.config.timeFormat === '24h') })])
      : el('div', { class: 'chat-msg-gutter' }, [el('span', { class: 'chat-avatar', text: initials(author) })]);

    const bodyContent = grouped
      ? bodyLines
      : [
          el('div', { class: 'chat-msg-meta' }, [
            el('span', { class: 'chat-msg-author', text: author }),
            el('span', { class: 'chat-msg-time', text: formatTime12(m.created_at, state.config.timeFormat === '24h') }),
          ]),
          ...bodyLines,
        ];

    messages.appendChild(
      el('div', { class: `chat-msg-row ${grouped ? 'grouped' : ''}` }, [gutter, el('div', { class: 'chat-msg-body' }, bodyContent)]),
    );
  }

  const input = el('textarea', { class: 'chat-input', rows: 1, placeholder: t('chat.messagePlaceholder', { name }) });
  const subjectInput = el('input', { class: 'chat-subject-input', type: 'text', maxlength: 200, placeholder: t('chat.subjectPlaceholder'), hidden: true });
  const sendBtn = el('button', { class: 'btn btn-primary chat-send-btn', type: 'submit', text: t('chat.send') });

  const subjectToggle = el(
    'button',
    {
      class: 'chat-plus-btn',
      type: 'button',
      'aria-label': t('chat.addSubject'),
      title: t('chat.addSubject'),
      onclick: () => {
        const opening = subjectInput.hidden;
        subjectInput.hidden = !opening;
        subjectToggle.classList.toggle('active', opening);
        if (opening) subjectInput.focus();
      },
    },
    [svgIcon(iconPaths('plus'))],
  );

  const form = el(
    'form',
    {
      class: 'chat-composer',
      onsubmit: (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        const subject = subjectInput.value.trim();
        const recipientId = thread.partnerId;

        // Optimistic: build the row locally and show it immediately: the
        // re-render this triggers rebuilds this whole form, so clear the
        // fields and re-focus a fresh input right away rather than relying
        // on stale references to the (about to be destroyed) DOM nodes.
        const row = {
          id: nextTempId(),
          subject,
          body,
          created_at: new Date().toISOString(),
          read: true,
          sender_id: state.ownUserId,
          recipient_id: recipientId,
        };
        optimisticInsert('messages', row, 'messages', { sender_id: state.ownUserId, recipient_id: recipientId, subject, body }).catch(
          (err) => showToast(t('compose.sendFailed', { msg: err.message }), 'bad'),
        );
        queueMicrotask(() => document.querySelector('.chat-input')?.focus());
      },
    },
    [subjectInput, el('div', { class: 'chat-input-row' }, [subjectToggle, input, sendBtn])],
  );

  return [header, messages, form];
}
