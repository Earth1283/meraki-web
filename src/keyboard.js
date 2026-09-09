import { state, moveSelection, openDetailForSelection, setTab, openOverlay, openCompose, closeOverlay, refresh, setActiveThread } from './state.js';
import { visibleTabs, messageThreads } from './rows.js';
import { trapTabKey } from './dom.js';

const overlayRoot = document.getElementById('overlay-root');

export function installGlobalKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (state.activeOverlay) {
      if (e.key === 'Escape') {
        closeOverlay();
        return;
      }
      // The detail panel is a real master-detail column on desktop (see the
      // comment on renderDetailPanel in overlays.js) — not a modal, so it
      // never traps Tab. Every other overlay dims the whole app behind a
      // backdrop and is trapped like a proper dialog.
      if (state.activeOverlay !== 'detail') trapTabKey(e, overlayRoot);
      return;
    }
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      // Esc blurs the focused field (e.g. the chat composer) so j/k/Tab
      // shortcuts work again without forcing a mouse click elsewhere.
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

    // Chat mode replaces the row-list/detail-panel model for Messages —
    // j/k/Enter have nothing sensible to act on there, but tab-switching,
    // refresh, etc. should still work normally.
    const chatModeActive = state.tab === 'messages' && state.chatMode;

    function moveThread(delta) {
      const threads = messageThreads(state.data, state.ownUserId);
      if (threads.length === 0) return;
      const idx = threads.findIndex((th) => th.partnerId === state.activeThreadPartnerId);
      const next = threads[(Math.max(idx, 0) + delta + threads.length) % threads.length];
      setActiveThread(next.partnerId);
    }

    if ((e.key === 'p' || e.key === 'k') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openOverlay('palette');
      return;
    }
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        if (chatModeActive) moveThread(1);
        else moveSelection(1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        if (chatModeActive) moveThread(-1);
        else moveSelection(-1);
        break;
      case 'Enter':
        if (chatModeActive) break;
        openDetailForSelection();
        break;
      case 'Tab': {
        e.preventDefault();
        const tabs = visibleTabs(state.config);
        if (tabs.length === 0) break;
        const idx = tabs.findIndex((t) => t.id === state.tab);
        const dir = e.shiftKey ? -1 : 1;
        setTab(tabs[(Math.max(idx, 0) + dir + tabs.length) % tabs.length].id);
        break;
      }
      case 'n':
        if (state.tab === 'messages') openCompose();
        else if (state.tab === 'me') openOverlay('checkin');
        break;
      case 'r':
        refresh();
        break;
      case ',':
        openOverlay('settings');
        break;
      case '?':
        openOverlay('help');
        break;
      default:
        break;
    }
  });
}
