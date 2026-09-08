// A right-click menu for row items. Every entry here is something the item
// itself makes possible (jump to its class, reply to its sender, copy what's
// on screen) — never a generic "Cut/Paste"-style menu that has nothing to do
// with what was clicked, and never an action the app can't actually perform
// (no "Delete", no "Mark as read" — there's no API for either).
import { el, svgIcon, clear } from './dom.js';
import { iconPaths } from './icons.js';
import { state, openDetailFor, setTab, openCompose } from './state.js';
import { detailFields } from './rows.js';
import { showToast, downloadFileUpload } from './overlays.js';
import { t } from './i18n.js';

const root = document.getElementById('contextmenu-root');
let cleanup = null;

export function closeContextMenu() {
  if (cleanup) cleanup();
}

const CLASS_SCOPED = {
  assignment: 'assignments',
  assessment: 'assessments',
  discussion: 'discussions',
  fileUpload: 'fileUploads',
};

function classIndexForItem(item) {
  if (!item?.class_id) return -1;
  return state.data.classes.findIndex((c) => c.id === item.class_id);
}

function copyDetails(target) {
  const { title, fields, body } = detailFields(target, state.data);
  const lines = [title, ...fields.filter(([, v]) => v != null && v !== '').map(([label, v]) => `${label}: ${v}`)];
  if (body) lines.push('', body);
  const text = lines.filter((l) => l != null).join('\n');
  if (!navigator.clipboard?.writeText) {
    showToast(t('menu.copyUnsupported'), 'bad');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => showToast(t('menu.copied')),
    () => showToast(t('menu.copyFailed'), 'bad'),
  );
}

function goToClass(classIndex) {
  setTab('classes');
  openDetailFor({ kind: 'class', index: classIndex });
}

function replySubject(subject) {
  if (!subject) return 'Re:';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** Builds the ordered list of {label, icon, action} entries for a row's
 * context menu, tailored to what that specific item is. */
export function menuItemsFor(target) {
  const data = state.data;
  const items = [{ icon: 'open', label: t('menu.open'), action: () => openDetailFor(target) }];

  switch (target.kind) {
    case 'message': {
      const m = data.messages[target.index];
      const replyToId = m.sender_id === state.ownUserId ? m.recipient_id : m.sender_id;
      if (replyToId) {
        items.push({
          icon: 'reply',
          label: t('menu.reply'),
          action: () => openCompose({ recipientId: replyToId, subject: replySubject(m.subject) }),
        });
      }
      break;
    }
    case 'class': {
      const c = data.classes[target.index];
      if (c.teacher_id) {
        items.push({
          icon: 'messages',
          label: c.teacher_name ? t('menu.messageName', { name: c.teacher_name }) : t('menu.messageTeacher'),
          action: () => openCompose({ recipientId: c.teacher_id }),
        });
      }
      break;
    }
    case 'grade': {
      const g = data.grades[target.index];
      const idx = data.assignments.findIndex((a) => a.id === g.assignment_id);
      if (idx !== -1) {
        items.push({ icon: 'assignments', label: t('menu.viewAssignment'), action: () => openDetailFor({ kind: 'assignment', index: idx }) });
      }
      break;
    }
    case 'assignment':
    case 'assessment':
    case 'discussion':
    case 'fileUpload': {
      const item = data[CLASS_SCOPED[target.kind]][target.index];
      const classIndex = classIndexForItem(item);
      if (classIndex !== -1) items.push({ icon: 'classes', label: t('menu.viewClass'), action: () => goToClass(classIndex) });
      if (target.kind === 'fileUpload') {
        items.push({ icon: 'download', label: t('menu.download'), action: () => downloadFileUpload(item) });
      }
      break;
    }
    case 'portfolio': {
      const p = data.portfolio[target.index];
      if (p.link) items.push({ icon: 'link', label: t('menu.openLink'), action: () => window.open(p.link, '_blank', 'noopener') });
      break;
    }
    default:
      break;
  }

  items.push({ separator: true }, { icon: 'copy', label: t('menu.copyDetails'), action: () => copyDetails(target) });
  return items;
}

export function openContextMenu(x, y, items) {
  closeContextMenu();
  if (!items?.length) return;

  const buttons = [];
  const menu = el(
    'div',
    { class: 'context-menu', role: 'menu' },
    items.map((item) => {
      if (item.separator) return el('div', { class: 'context-menu-sep' });
      const btn = el(
        'button',
        {
          class: 'context-menu-item',
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            closeContextMenu();
            item.action();
          },
        },
        [
          el('span', { class: 'context-menu-icon' }, item.icon ? [svgIcon(iconPaths(item.icon))] : []),
          el('span', { class: 'context-menu-label', text: item.label }),
        ],
      );
      buttons.push(btn);
      return btn;
    }),
  );

  menu.style.visibility = 'hidden';
  root.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';

  let selected = -1;
  function moveSelection(delta) {
    selected = Math.max(0, Math.min(selected + delta, buttons.length - 1));
    buttons[selected]?.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    }
  }
  function onOutside(e) {
    if (!menu.contains(e.target)) closeContextMenu();
  }
  function onBlurAway() {
    closeContextMenu();
  }

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('contextmenu', onOutside, true);
  window.addEventListener('scroll', onBlurAway, true);
  window.addEventListener('resize', onBlurAway);

  cleanup = () => {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('contextmenu', onOutside, true);
    window.removeEventListener('scroll', onBlurAway, true);
    window.removeEventListener('resize', onBlurAway);
    clear(root);
    cleanup = null;
  };

  queueMicrotask(() => buttons[0]?.focus());
}
