import { el, clear, mount, svgIcon } from './dom.js';
import * as api from './api.js';
import { state, subscribe, isLoggedIn, afterLogin, refresh, setTab, doLogout, openOverlay, openCompose, openDetailFor, toggleMobileNav, closeMobileNav, toggleSidebar, toggleChatMode } from './state.js';
import { tabTitle, rowKinds, renderItemBody, renderInfoRow, overviewSummary, renderOverviewStats, visibleTabs } from './rows.js';
import { iconPaths } from './icons.js';
import { privacyParagraphs } from './privacy.js';
import { mountLogin, renderOverlay, renderDetailPanel, showToast } from './overlays.js';
import { renderChat } from './chat.js';
import { installGlobalKeyboard } from './keyboard.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';

const loginScreen = document.getElementById('login-screen');
const shell = document.getElementById('shell');
const tabbar = document.getElementById('tabbar');
const toolbar = document.getElementById('toolbar');
const body = document.getElementById('body');

function render() {
  if (!isLoggedIn()) {
    shell.hidden = true;
    loginScreen.hidden = false;
    mountLogin(loginScreen, async () => {
      loginScreen.hidden = true;
      shell.hidden = false;
      await afterLogin();
    });
    return;
  }
  loginScreen.hidden = true;
  shell.hidden = false;
  shell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  renderTabbar();
  renderToolbar();
  renderBody();
  renderDetailPanel();
  renderOverlay();
}

function renderTabbar() {
  tabbar.classList.toggle('open', state.mobileNavOpen);
  tabbar.classList.toggle('collapsed', state.sidebarCollapsed);
  mount(
    tabbar,
    el('div', { class: 'tabbar-inner' }, [
      el('div', { class: 'tabbar-top' }, [
        el('div', { class: 'brand-mark', text: 'Meraki' }),
        el(
          'button',
          {
            class: 'sidebar-toggle',
            type: 'button',
            'aria-label': state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
            title: state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
            onclick: () => toggleSidebar(),
          },
          [svgIcon(iconPaths(state.sidebarCollapsed ? 'expand' : 'collapse'))],
        ),
      ]),
      el(
        'div',
        { class: 'nav-list' },
        visibleTabs(state.config).map((t) =>
          el(
            'button',
            {
              class: `nav-item ${state.tab === t.id ? 'active' : ''}`,
              type: 'button',
              title: t.title,
              onclick: () => setTab(t.id),
            },
            [el('span', { class: 'nav-icon' }, [svgIcon(iconPaths(t.id))]), el('span', { class: 'nav-label', text: t.title })],
          ),
        ),
      ),
    ]),
  );

  const backdropId = 'mobile-nav-backdrop';
  let backdrop = document.getElementById(backdropId);
  if (state.mobileNavOpen && !backdrop) {
    backdrop = el('div', { id: backdropId, class: 'tabbar-backdrop', onclick: closeMobileNav });
    document.body.appendChild(backdrop);
  } else if (!state.mobileNavOpen && backdrop) {
    backdrop.remove();
  }
}

function renderToolbar() {
  const actions = [];
  if (state.tab === 'messages') {
    actions.push(
      el(
        'button',
        {
          class: `btn-icon ${state.chatMode ? 'active-toggle' : ''}`,
          type: 'button',
          'aria-label': state.chatMode ? 'Switch to list view' : 'Switch to chat view',
          title: state.chatMode ? 'Switch to list view' : 'Switch to chat view (just for fun)',
          onclick: () => toggleChatMode(),
        },
        [svgIcon(iconPaths('chat'))],
      ),
    );
    actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCompose(), text: 'New message' }));
  }
  if (state.tab === 'me') {
    actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openOverlay('checkin'), text: 'Check in' }));
  }
  actions.push(
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Refresh', title: 'Refresh', onclick: () => refresh(), text: '⟳' }),
    el(
      'button',
      { class: 'btn-icon', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => openOverlay('settings') },
      [svgIcon(iconPaths('settings'))],
    ),
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts', onclick: () => openOverlay('help'), text: '?' }),
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Log out', title: 'Log out', onclick: () => doLogout(), text: '⏻' }),
  );

  mount(
    toolbar,
    el('div', { class: 'toolbar-inner' }, [
      el('div', { class: 'toolbar-left' }, [
        el('button', { class: 'hamburger-btn', type: 'button', 'aria-label': 'Open menu', onclick: () => toggleMobileNav(), text: '☰' }),
        el('h1', { class: 'toolbar-title', text: tabTitle(state.tab) }),
      ]),
      el('div', { class: 'toolbar-actions' }, actions),
    ]),
  );
}

function renderBody() {
  clear(body);
  body.classList.toggle('chat-mode', state.tab === 'messages' && state.chatMode);

  if (state.loading && !state.hasLoadedOnce) {
    body.appendChild(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' }), el('p', { text: 'Loading your data…' })]));
    return;
  }

  if (state.tab === 'messages' && state.chatMode) {
    renderChat(body);
    return;
  }

  if (state.error) {
    body.appendChild(el('div', { class: 'banner-error', text: state.error }));
  }

  if (state.tab === 'privacy') {
    body.appendChild(renderPrivacy());
    return;
  }

  if (state.tab === 'overview') {
    body.appendChild(renderOverviewStats(overviewSummary(state.data), setTab));
  }

  const kinds = rowKinds(state.tab, state.data);
  if (kinds.length === 0) {
    body.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'empty-icon', text: '·' }), el('p', { text: 'Nothing here yet.' })]));
    return;
  }

  let itemCounter = -1;
  const list = el('div', { class: 'row-list' });
  for (const kind of kinds) {
    if (kind.type === 'header') {
      list.appendChild(el('div', { class: 'row-section', text: kind.label }));
    } else if (kind.type === 'placeholder') {
      list.appendChild(el('div', { class: 'row-placeholder', text: kind.text }));
    } else if (kind.type === 'info') {
      list.appendChild(renderInfoRow(state.data));
    } else if (kind.type === 'item') {
      itemCounter += 1;
      const isSelected = itemCounter === state.selectedIndex;
      const target = kind.target;
      const rowBtn = el(
        'button',
        {
          class: `row-item ${isSelected ? 'selected' : ''}`,
          type: 'button',
          onclick: () => openDetailFor(target),
          oncontextmenu: (e) => {
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, menuItemsFor(target));
          },
        },
        [renderItemBody(target, state.data, state.ownUserId)],
      );
      list.appendChild(rowBtn);
    }
  }
  body.appendChild(list);
}

function renderPrivacy() {
  const container = el('div', { class: 'privacy' });
  for (const para of privacyParagraphs()) {
    const p = el('div', { class: `privacy-para ${para.cls}` });
    para.lines.forEach((line, i) => {
      if (line.label !== undefined) {
        p.appendChild(el('div', { class: 'privacy-row' }, [el('span', { class: 'privacy-row-label', text: line.label }), el('span', { class: 'privacy-row-desc', text: line.desc })]));
      } else {
        const isHeading = i === 0 && para.cls === 'priv-section';
        p.appendChild(el('p', { class: isHeading ? 'privacy-heading' : undefined, text: line.text }));
      }
    });
    container.appendChild(p);
  }
  return container;
}

subscribe(render);
installGlobalKeyboard();

if (isLoggedIn()) {
  afterLogin().catch((err) => showToast(err.message, 'bad'));
}
render();
