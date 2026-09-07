import { state, moveSelection, openDetailForSelection, setTab, openOverlay, openCompose, closeOverlay, refresh } from './state.js';
import { visibleTabs } from './rows.js';

export function installGlobalKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (state.activeOverlay) {
      if (e.key === 'Escape') closeOverlay();
      return;
    }
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    // Chat mode replaces the row-list/detail-panel model for Messages —
    // j/k/Enter have nothing sensible to act on there, but tab-switching,
    // refresh, etc. should still work normally.
    const chatModeActive = state.tab === 'messages' && state.chatMode;

    if ((e.key === 'p' || e.key === 'k') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openOverlay('palette');
      return;
    }
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        if (chatModeActive) break;
        e.preventDefault();
        moveSelection(1);
        break;
      case 'k':
      case 'ArrowUp':
        if (chatModeActive) break;
        e.preventDefault();
        moveSelection(-1);
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
