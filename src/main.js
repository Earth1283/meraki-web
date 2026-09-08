import { el, clear, mount, svgIcon } from './dom.js';
import * as api from './api.js';
import { state, subscribe, isLoggedIn, afterLogin, refresh, setTab, doLogout, openOverlay, openCompose, openDetailFor, toggleMobileNav, closeMobileNav, toggleSidebar, toggleChatMode, toggleOverviewSection } from './state.js';
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

// renderBody() tears down and rebuilds the whole row list on every render
// (no vdom diffing here), so a plain CSS transition on a class toggle has
// no "before" frame to animate from — the old node is just gone. This
// remembers each overview section's collapse state from the previous
// render so a toggle can be told apart from a steady-state refresh, and
// the reveal/rotation is done the same way showToast() does its fade-in:
// mount in the "before" state, then flip to the "after" state on the next
// frame so the browser has something to interpolate.
let prevOverviewCollapse = { ...state.overviewCollapse };

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
  // renderBody() tears the whole row list down and rebuilds it from scratch
  // (see the note above render()), which would otherwise silently reset
  // scroll position and drop keyboard focus on every refresh — including
  // background auto-refreshes the user didn't ask for. Save both before the
  // teardown and restore them after the rebuild below.
  const savedScrollTop = body.scrollTop;
  const focusWasInBody = body.contains(document.activeElement) && document.activeElement !== body;
  const focusedSelectedIndex = focusWasInBody ? state.selectedIndex : null;

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
    body.appendChild(
      el('div', { class: 'banner-error', role: 'alert' }, [
        el('span', { text: state.error }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => refresh(), text: 'Retry' }),
      ]),
    );
  }

  if (state.tab === 'privacy') {
    body.appendChild(renderPrivacy());
    return;
  }

  if (state.tab === 'overview') {
    body.appendChild(renderOverviewStats(overviewSummary(state.data), setTab));
  }

  const kinds = rowKinds(state.tab, state.data, new Date(), state.overviewCollapse);
  if (kinds.length === 0) {
    body.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'empty-icon', text: '·' }), el('p', { text: 'Nothing here yet.' })]));
    return;
  }

  let itemCounter = -1;
  const list = el('div', { class: 'row-list' });
  // Rows belonging to the current collapsible section (between a
  // collapsible-header and the next header of any kind) land in this
  // group container instead of directly in `list`, so the reveal
  // animation below has one node per section to animate.
  let activeGroup = null;
  const chevronsToRotate = [];
  const groupsToReveal = [];

  for (const kind of kinds) {
    if (kind.type === 'header') {
      activeGroup = null;
      list.appendChild(el('div', { class: 'row-section', text: kind.label }));
    } else if (kind.type === 'collapsible-header') {
      const wasCollapsed = prevOverviewCollapse[kind.section];
      const justToggled = wasCollapsed !== undefined && wasCollapsed !== kind.collapsed;

      // Disclosure triangle: points right while collapsed, rotates down
      // when expanded — one icon, rotated, rather than swapping between
      // two different chevron glyphs (which read as two unrelated icons
      // rather than one thing turning).
      const chevron = svgIcon(iconPaths('chevronDown'));
      chevron.classList.add('row-section-chevron-icon');
      chevron.classList.toggle('collapsed', justToggled ? wasCollapsed : kind.collapsed);
      if (justToggled) chevronsToRotate.push({ chevron, collapsed: kind.collapsed });

      list.appendChild(
        el(
          'button',
          {
            class: 'row-section row-section-toggle',
            type: 'button',
            onclick: () => toggleOverviewSection(kind.section),
            'aria-expanded': !kind.collapsed,
          },
          [el('span', { class: 'row-section-chevron' }, [chevron]), el('span', { text: `${kind.label} (${kind.count})` })],
        ),
      );

      activeGroup = el('div', { class: 'row-list section-items' });
      if (justToggled && !kind.collapsed) {
        activeGroup.classList.add('reveal-pending');
        groupsToReveal.push(activeGroup);
      }
      list.appendChild(activeGroup);
    } else if (kind.type === 'placeholder') {
      // Grey placeholder text on grey background is easy to skim right
      // past — the "you're caught up" case is good news worth actually
      // noticing, so it gets the same green check badge as a done item
      // instead of blending into every other empty-state message.
      const isGood = kind.tone === 'good';
      (activeGroup ?? list).appendChild(
        el('div', { class: `row-placeholder ${isGood ? 'row-placeholder-good' : ''}` }, [
          isGood ? el('span', { class: 'row-done-check' }, [svgIcon(iconPaths('check'))]) : null,
          el('span', { text: kind.text }),
        ]),
      );
    } else if (kind.type === 'info') {
      (activeGroup ?? list).appendChild(renderInfoRow(state.data));
    } else if (kind.type === 'item') {
      itemCounter += 1;
      const isSelected = itemCounter === state.selectedIndex;
      const target = kind.target;
      const rowBtn = el(
        'button',
        {
          class: `row-item ${isSelected ? 'selected' : ''} ${kind.done ? 'row-item-done' : ''}`,
          type: 'button',
          onclick: () => openDetailFor(target, itemCounter),
          oncontextmenu: (e) => {
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, menuItemsFor(target));
          },
        },
        [
          kind.done ? el('span', { class: 'row-done-check' }, [svgIcon(iconPaths('check'))]) : null,
          renderItemBody(target, state.data, state.ownUserId),
        ],
      );
      (activeGroup ?? list).appendChild(rowBtn);
    }
  }
  body.appendChild(list);
  body.scrollTop = savedScrollTop;
  if (focusedSelectedIndex !== null) {
    const rows = list.querySelectorAll('.row-item');
    rows[focusedSelectedIndex]?.focus();
  }

  if (chevronsToRotate.length || groupsToReveal.length) {
    requestAnimationFrame(() => {
      chevronsToRotate.forEach(({ chevron, collapsed }) => chevron.classList.toggle('collapsed', collapsed));
      groupsToReveal.forEach((node) => node.classList.add('reveal-in'));
    });
  }
  prevOverviewCollapse = { ...state.overviewCollapse };
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
