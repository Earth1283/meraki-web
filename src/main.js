import { el, clear, mount, svgIcon } from './dom.js';
import * as api from './api.js';
import { state, subscribe, isLoggedIn, afterLogin, refresh, setTab, doLogout, openOverlay, openCompose, openDetailFor, toggleMobileNav, closeMobileNav, toggleSidebar, toggleChatMode, toggleOverviewSection, setConfig, setGradeTarget } from './state.js';
import { tabTitle, rowKinds, renderItemBody, renderInfoRow, overviewSummary, renderOverviewStats, visibleTabs } from './rows.js';
import { renderAnalyticsTab, chartModeToggle, mountAnalyticsCharts, disposeAnalyticsCharts } from './analytics.js';
import { iconPaths } from './icons.js';
import { privacyParagraphs } from './privacy.js';
import { mountLogin, renderOverlay, renderDetailPanel, showToast, buildLanguageSwitcher } from './overlays.js';
import { renderChat } from './chat.js';
import { installGlobalKeyboard } from './keyboard.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';
import { i18nReady, t, onChange as onLocaleChange } from './i18n.js';

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
        el('div', { class: 'brand-mark', text: t('brand') }),
        el(
          'button',
          {
            class: 'sidebar-toggle',
            type: 'button',
            'aria-label': state.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse'),
            title: state.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse'),
            onclick: () => toggleSidebar(),
          },
          [svgIcon(iconPaths(state.sidebarCollapsed ? 'expand' : 'collapse'))],
        ),
      ]),
      buildLanguageSwitcher('tabbar-lang-switcher'),
      el(
        'div',
        { class: 'nav-list' },
        visibleTabs(state.config).map((tb) =>
          el(
            'button',
            {
              class: `nav-item ${state.tab === tb.id ? 'active' : ''}`,
              type: 'button',
              title: tb.title,
              onclick: () => setTab(tb.id),
            },
            [el('span', { class: 'nav-icon' }, [svgIcon(iconPaths(tb.id))]), el('span', { class: 'nav-label', text: tb.title })],
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
          'aria-label': state.chatMode ? t('toolbar.listView') : t('toolbar.chatView'),
          title: state.chatMode ? t('toolbar.listView') : t('toolbar.chatView'),
          onclick: () => toggleChatMode(),
        },
        [svgIcon(iconPaths('chat'))],
      ),
    );
    actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCompose(), text: t('toolbar.newMessage') }));
  }
  if (state.tab === 'me') {
    actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openOverlay('checkin'), text: t('toolbar.checkIn') }));
  }
  if (state.tab === 'analytics') {
    actions.push(chartModeToggle(state.config, (chartMode) => setConfig({ chartMode })));
  }
  actions.push(
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('toolbar.refresh'), title: t('toolbar.refresh'), onclick: () => refresh(), text: '⟳' }),
    el(
      'button',
      { class: 'btn-icon', type: 'button', 'aria-label': t('toolbar.settings'), title: t('toolbar.settings'), onclick: () => openOverlay('settings') },
      [svgIcon(iconPaths('settings'))],
    ),
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('toolbar.help'), title: t('toolbar.help'), onclick: () => openOverlay('help'), text: '?' }),
    el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('toolbar.logout'), title: t('toolbar.logout'), onclick: () => doLogout(), text: '⏻' }),
  );

  mount(
    toolbar,
    el('div', { class: 'toolbar-inner' }, [
      el('div', { class: 'toolbar-left' }, [
        el('button', { class: 'hamburger-btn', type: 'button', 'aria-label': t('toolbar.openMenu'), onclick: () => toggleMobileNav(), text: '☰' }),
        el('h1', { class: 'toolbar-title', text: tabTitle(state.tab) }),
      ]),
      el('div', { class: 'toolbar-actions' }, actions),
    ]),
  );
}

// The loading checklist gets a notify() per step transition, but renderBody()
// otherwise tears the whole body down every render (see below) — doing that
// here would restart every earlier step's checkmark animation on each tick.
// So this card is built once and its <li>s are patched in place instead;
// these refs are only valid while state.loading && !state.hasLoadedOnce.
let loadingChecklistEl = null;
let loadingStepEls = null;
let loadingProgressFillEl = null;

function stepIconContent(status) {
  if (status === 'done') return svgIcon(iconPaths('check'));
  if (status === 'active') return el('span', { class: 'spinner spinner-sm' });
  return el('span', { class: 'loading-step-dot' });
}

function buildLoadingChecklist() {
  loadingStepEls = state.loadingSteps.map((s) => {
    const icon = el('span', { class: 'loading-step-icon' }, [stepIconContent(s.status)]);
    const li = el('li', { class: `loading-step is-${s.status}` }, [icon, el('span', { class: 'loading-step-label', text: t(s.labelKey) })]);
    return { status: s.status, li, icon };
  });
  loadingProgressFillEl = el('div', { class: 'loading-progress-fill' });
  loadingChecklistEl = el('div', { class: 'loading-state loading-checklist' }, [
    el('ul', { class: 'loading-steps' }, loadingStepEls.map((s) => s.li)),
    el('div', { class: 'loading-progress' }, [loadingProgressFillEl]),
  ]);
  updateLoadingChecklist();
  return loadingChecklistEl;
}

function updateLoadingChecklist() {
  state.loadingSteps.forEach((s, i) => {
    const stepEl = loadingStepEls[i];
    if (!stepEl || stepEl.status === s.status) return;
    stepEl.status = s.status;
    stepEl.li.className = `loading-step is-${s.status}`;
    clear(stepEl.icon);
    stepEl.icon.appendChild(stepIconContent(s.status));
  });
  const doneCount = state.loadingSteps.filter((s) => s.status === 'done').length;
  loadingProgressFillEl.style.width = `${(doneCount / state.loadingSteps.length) * 100}%`;
}

function renderBody() {
  if (state.loading && !state.hasLoadedOnce) {
    if (loadingChecklistEl && body.contains(loadingChecklistEl)) {
      updateLoadingChecklist();
    } else {
      disposeAnalyticsCharts();
      clear(body);
      body.classList.remove('chat-mode');
      body.appendChild(buildLoadingChecklist());
    }
    return;
  }
  loadingChecklistEl = null;

  // renderBody() tears the whole row list down and rebuilds it from scratch
  // (see the note above render()), which would otherwise silently reset
  // scroll position and drop keyboard focus on every refresh — including
  // background auto-refreshes the user didn't ask for. Save both before the
  // teardown and restore them after the rebuild below.
  const savedScrollTop = body.scrollTop;
  const focusWasInBody = body.contains(document.activeElement) && document.activeElement !== body;
  const focusedSelectedIndex = focusWasInBody ? state.selectedIndex : null;

  disposeAnalyticsCharts();
  clear(body);
  body.classList.toggle('chat-mode', state.tab === 'messages' && state.chatMode);

  if (state.tab === 'messages' && state.chatMode) {
    renderChat(body);
    return;
  }

  if (state.error) {
    body.appendChild(
      el('div', { class: 'banner-error', role: 'alert' }, [
        el('span', { text: state.error }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => refresh(), text: t('state.retry') }),
      ]),
    );
  }

  if (state.tab === 'privacy') {
    body.appendChild(renderPrivacy());
    return;
  }

  if (state.tab === 'analytics') {
    const node = renderAnalyticsTab(state.data, state.config, state.gradeTargets, setGradeTarget);
    body.appendChild(node);
    if (state.config.chartMode === 'echarts') mountAnalyticsCharts(node, { dark: isDarkTheme() });
    return;
  }

  if (state.tab === 'overview') {
    body.appendChild(renderOverviewStats(overviewSummary(state.data), setTab));
  }

  const kinds = rowKinds(state.tab, state.data, new Date(), state.overviewCollapse);
  if (kinds.length === 0) {
    body.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'empty-icon', text: '·' }), el('p', { text: t('state.nothingHere') })]));
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

function isDarkTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
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
onLocaleChange(render);
installGlobalKeyboard();

if (isLoggedIn()) {
  afterLogin().catch((err) => showToast(err.message, 'bad'));
}
// Wait for the active locale's strings before the first paint so the login
// screen never flashes raw translation keys; subsequent locale switches are
// instant since every locale's fetch already kicked off in i18n.js.
i18nReady.then(render);
