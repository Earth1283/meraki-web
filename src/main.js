import { el, clear, mount, svgIcon, associateFieldLabels } from './dom.js';
import * as api from './api.js';
import { state, subscribe, isLoggedIn, afterLogin, refresh, setTab, doLogout, openOverlay, openCompose, openDetailFor, toggleMobileNav, closeMobileNav, toggleSidebar, toggleChatMode, toggleOverviewSection, setConfig, setGradeTarget, setWhatIf, clearWhatIf, setCalendarViewMonth, setCalendarSelectedDate, setMobileCalendarView, openReminderForm, removeCalendarReminder, addCalendarReminder, rowKindsForCurrentTab } from './state.js';
import { tabTitle, renderItemBody, renderInfoRow, overviewSummary, renderOverviewStats, visibleTabs, emptyState, renderAttendanceTally, NAV_GROUPS } from './rows.js';
import { renderAnalyticsTab, chartModeToggle, mountAnalyticsCharts, disposeAnalyticsCharts } from './analytics.js';
import { renderCalendarGrid, calendarViewToggle, calendarOnlyMineToggle, isoOf } from './calendar.js';
import { seededRandom, sketchBox, sketchLine, sketchTick, sketchSvg } from './sketch.js';
import { GRADING_SCALES, overallGrade } from './grading.js';
import { iconPaths } from './icons.js';
import { renderPrivacyTab } from './privacy.js';
import { renderActivityFeed } from './activity.js';
import { mountLogin, renderOverlay, renderDetailPanel } from './overlays.js';
import { showToast } from './toast.js';
import { renderChat } from './chat.js';
import { renderLoadMore, disconnectLoadMore } from './loadmore.js';
import { renderLoadingTray } from './loadingtray.js';
import { isErrorDismissed, restoreError, dismissButton } from './dismissible.js';
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
  renderLoadingTray();
  associateFieldLabels(shell);
  associateFieldLabels(document.getElementById('overlay-root'));
}

// The tabbar is rebuilt on every render too, so the highlighter swipe on the
// active nav item would replay on every refresh/detail-open if it were keyed
// off .active alone. This remembers the last tab drawn so the swipe only
// plays on an actual tab switch.
let lastRenderedTab = null;

function renderTabbar() {
  const tabJustChanged = lastRenderedTab !== null && lastRenderedTab !== state.tab;
  lastRenderedTab = state.tab;
  tabbar.classList.toggle('open', state.mobileNavOpen);
  tabbar.classList.toggle('collapsed', state.sidebarCollapsed);
  const mobileSidebar = window.matchMedia('(max-width: 900px)').matches;
  tabbar.inert = mobileSidebar && !state.mobileNavOpen;
  tabbar.setAttribute('aria-hidden', mobileSidebar && !state.mobileNavOpen ? 'true' : 'false');
  const visible = visibleTabs(state.config);
  const navigation = NAV_GROUPS.map((group) => {
    const groupTabs = visible.filter((tab) => group.tabs.includes(tab.id));
    if (!groupTabs.length) return null;
    return el('div', { class: 'nav-group', 'data-nav-group': group.id }, [
      el('div', { class: 'nav-group-label', text: t(group.labelKey) }),
      ...groupTabs.map((tb) =>
        el(
          'button',
          {
            class: `nav-item ${state.tab === tb.id ? 'active' : ''} ${state.tab === tb.id && tabJustChanged ? 'just-activated' : ''}`,
            type: 'button',
            title: tb.title,
            'data-nav-group': group.id,
            'aria-current': state.tab === tb.id ? 'page' : null,
            onclick: () => setTab(tb.id),
          },
          [el('span', { class: 'nav-icon' }, [svgIcon(iconPaths(tb.id))]), el('span', { class: 'nav-label', text: tb.title })],
        )),
    ]);
  }).filter(Boolean);
  const session = api.getSession();
  const identity = state.ownStudentName || session?.email?.split('@')[0] || t('account.student');
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
      el('div', { class: 'nav-list' }, navigation),
      el('div', { class: 'account-summary' }, [
        el('span', { class: 'account-avatar', text: identity.slice(0, 1).toUpperCase() }),
        el('span', { class: 'account-copy' }, [
          el('span', { class: 'account-name', text: identity }),
          session?.email ? el('span', { class: 'account-email', text: session.email }) : null,
        ]),
      ]),
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

function isPhoneLayout() {
  return window.matchMedia('(max-width: 640px)').matches;
}

function activeCalendarView() {
  if (!isPhoneLayout()) return state.config.calendarView;
  return state.mobileCalendarView ?? 'list';
}

function renderToolbar() {
  const actions = [];
  if (state.tab === 'messages') {
    actions.push(
      el(
        'button',
        {
          class: `btn toolbar-view-mode ${state.chatMode ? 'active-toggle' : ''}`,
          type: 'button',
          'aria-label': state.chatMode ? t('toolbar.listView') : t('toolbar.chatView'),
          title: state.chatMode ? t('toolbar.listView') : t('toolbar.chatView'),
          onclick: () => toggleChatMode(),
        },
        [svgIcon(iconPaths('chat')), el('span', { class: 'toolbar-action-label', text: state.chatMode ? t('toolbar.listLabel') : t('toolbar.chatLabel') })],
      ),
    );
    actions.push(el('button', { class: 'btn btn-primary toolbar-primary', type: 'button', onclick: () => openCompose(), title: t('toolbar.newMessage') }, [svgIcon(iconPaths('plus')), el('span', { class: 'toolbar-action-label', text: t('toolbar.newMessage') })]));
  }
  if (state.tab === 'me') {
    actions.push(
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': t('portfolio.addTitle'), title: t('portfolio.addTitle'), onclick: () => openOverlay('portfolio') }, [svgIcon(iconPaths('plus'))]),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openOverlay('checkin'), text: t('toolbar.checkIn') }),
    );
  }
  if (state.tab === 'analytics') {
    actions.push(chartModeToggle(state.config, (chartMode) => setConfig({ chartMode })));
  }
  if (state.tab === 'calendar') {
    const view = activeCalendarView();
    actions.push(calendarViewToggle({ calendarView: view }, (calendarView) => {
      if (isPhoneLayout()) setMobileCalendarView(calendarView);
      else setConfig({ calendarView });
    }));
    actions.push(calendarOnlyMineToggle(state.config, (calendarOnlyMine) => setConfig({ calendarOnlyMine })));
    if (view === 'list') {
      actions.push(el('button', { class: 'btn btn-primary toolbar-primary', type: 'button', onclick: () => openReminderForm(), title: t('calendar.addReminder') }, [svgIcon(iconPaths('plus')), el('span', { class: 'toolbar-action-label', text: t('calendar.addReminder') })]));
    }
  }
  actions.push(
    el('span', { class: 'toolbar-divider', 'aria-hidden': 'true' }),
    el('button', { class: 'btn-icon toolbar-desktop-action', type: 'button', 'aria-label': t('toolbar.refresh'), title: t('toolbar.refresh'), onclick: () => refresh() }, [svgIcon(iconPaths('refresh'))]),
    el(
      'button',
      { class: 'btn-icon toolbar-desktop-action', type: 'button', 'aria-label': t('toolbar.settings'), title: t('toolbar.settings'), onclick: () => openOverlay('settings') },
      [svgIcon(iconPaths('settings'))],
    ),
    el('button', {
      class: 'btn-icon',
      type: 'button',
      'aria-label': t('toolbar.more'),
      title: t('toolbar.more'),
      onclick: (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        openContextMenu(rect.right, rect.bottom, [
          { icon: 'refresh', label: t('toolbar.refresh'), action: refresh },
          { icon: 'settings', label: t('toolbar.settings'), action: () => openOverlay('settings') },
          { icon: 'help', label: t('toolbar.help'), action: () => openOverlay('help') },
          { icon: 'book', label: t('toolbar.resources'), action: () => openOverlay('resources') },
          { separator: true },
          { icon: 'logout', label: t('toolbar.logout'), action: doLogout },
        ]);
      },
    }, [svgIcon(iconPaths('more'))]),
  );

  mount(
    toolbar,
    el('div', { class: 'toolbar-inner' }, [
      el('div', { class: 'toolbar-left' }, [
        el('button', { class: 'hamburger-btn', type: 'button', 'aria-label': t('toolbar.openMenu'), onclick: () => toggleMobileNav() }, [svgIcon(iconPaths('menu'))]),
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

function stepIconContent(step) {
  const { status } = step;
  if (state.config.style === 'notebook') {
    // A hand-drawn checkbox per step. updateLoadingChecklist() only swaps
    // icons when a step's status changes, so the tick is created, and
    // draws in, exactly once: on the transition to done.
    const box = sketchSvg(sketchBox(1, 1, 18, 18, seededRandom(`step-box:${step.id}`), { bow: 0.8, overshoot: 1.5, jitter: 0.6 }), { viewBox: [20, 20], className: 'sketch-step-box' });
    if (status === 'done') return [box, sketchSvg([sketchTick(3, 1, 16, seededRandom(`step-tick:${step.id}`))], { viewBox: [20, 20], draw: true, className: 'sketch-step-tick' })];
    if (status === 'active') return [box, el('span', { class: 'spinner spinner-sm' })];
    return [box];
  }
  if (status === 'done') return svgIcon(iconPaths('check'));
  if (status === 'active') return el('span', { class: 'spinner spinner-sm' });
  return el('span', { class: 'loading-step-dot' });
}

function buildLoadingChecklist() {
  loadingStepEls = state.loadingSteps.map((s) => {
    const icon = el('span', { class: 'loading-step-icon' }, stepIconContent(s));
    const label = el('span', { class: 'loading-step-label', text: t(s.labelKey) });
    const li = el('li', { class: `loading-step is-${s.status}` }, [icon, label]);
    return { status: s.status, li, icon, label };
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
    if (!stepEl) return;
    // Re-read on every update, not just at build time: a returning session
    // starts loading before the locale file has arrived, so the first build
    // can only hold raw keys.
    stepEl.label.textContent = t(s.labelKey);
    if (stepEl.status === s.status) return;
    stepEl.status = s.status;
    stepEl.li.className = `loading-step is-${s.status}`;
    clear(stepEl.icon);
    stepEl.icon.append(...[].concat(stepIconContent(s)));
  });
  const doneCount = state.loadingSteps.filter((s) => s.status === 'done').length;
  loadingProgressFillEl.style.width = `${(doneCount / state.loadingSteps.length) * 100}%`;
}

// Right-click menu for a calendar grid day cell. Unlike menuItemsFor() this
// isn't keyed off a single row target — a day can hold any mix of real
// events, assignment due dates, and local reminders, so the menu is built
// straight from the cell's merged item list instead of going through the
// generic per-kind dispatch in contextmenu.js.
// Deletes immediately (no "are you sure?" dialog — reminders are local and
// low-stakes) but keeps the just-deleted reminder around long enough to
// re-add verbatim if the toast's Undo is clicked, so the missing confirm
// dialog doesn't cost real recoverability.
// Row context menus, plus Delete (with undo) for reminder rows in the
// calendar list. Reminders live outside state.data, so that action is wired
// here beside deleteReminderWithUndo rather than in contextmenu.js.
function rowMenuItems(target) {
  const items = menuItemsFor(target);
  if (target.kind === 'reminder') {
    const at = items.findIndex((item) => item.separator);
    items.splice(at === -1 ? items.length : at, 0, {
      icon: 'trash',
      label: t('calendar.deleteReminderNamed', { title: target.reminder.title }),
      action: () => deleteReminderWithUndo(target.reminder),
    });
  }
  return items;
}

function deleteReminderWithUndo(reminder) {
  removeCalendarReminder(reminder.id);
  showToast(t('calendar.reminderDeleted'), 'ok', {
    label: t('action.undo'),
    onClick: () => addCalendarReminder({ title: reminder.title, date: reminder.date, note: reminder.note }),
  });
}

function dayContextMenuItems(cell) {
  const items = [{ icon: 'plus', label: t('calendar.addReminder'), action: () => openReminderForm(cell.iso) }];
  const openable = cell.items.filter((item) => item.kind !== 'reminder');
  const reminders = cell.items.filter((item) => item.kind === 'reminder');
  if (openable.length || reminders.length) items.push({ separator: true });
  for (const item of openable) {
    items.push({ icon: 'open', label: item.title, action: () => openDetailFor({ kind: item.kind, index: item.index }) });
  }
  for (const item of reminders) {
    items.push({ icon: 'trash', label: t('calendar.deleteReminderNamed', { title: item.title }), action: () => deleteReminderWithUndo(item.reminder) });
  }
  return items;
}

// The done badge on Overview rows and on the "caught up" placeholder: a green
// check chip normally, a pen tick in Notebook style.
function doneCheck(seed, draw) {
  if (state.config.style !== 'notebook') return el('span', { class: 'row-done-check' }, [svgIcon(iconPaths('check'))]);
  return el('span', { class: 'row-done-check' }, [
    sketchSvg([sketchTick(3, 2, 15, seededRandom(`done:${seed}`))], { viewBox: [20, 20], draw, className: 'sketch-done-tick' }),
  ]);
}

// The body "view" from the previous renderBody(), so views that animate on
// arrival (the Notebook calendar's marks) can tell a fresh visit apart from
// a same-view rebuild.
let prevBodyView = null;

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
  // Focus on the Load more button goes back to the new button, not to the
  // selected row (which would scroll the list back up to it).
  const focusWasOnLoadMore = !!document.activeElement?.closest?.('.load-more');
  const focusWasInBody = body.contains(document.activeElement) && document.activeElement !== body && !focusWasOnLoadMore;
  const focusedSelectedIndex = focusWasInBody ? state.selectedIndex : null;

  disposeAnalyticsCharts();
  disconnectLoadMore();
  clear(body);
  body.classList.toggle('chat-mode', state.tab === 'messages' && state.chatMode);
  const notebook = state.config.style === 'notebook';
  const bodyView = [state.tab, state.chatMode, state.config.calendarView, state.config.style].join(':');
  const freshView = bodyView !== prevBodyView;
  prevBodyView = bodyView;

  if (state.tab === 'messages' && state.chatMode) {
    renderChat(body);
    return;
  }

  if (state.error && !isErrorDismissed(state.error)) {
    const message = state.error;
    body.appendChild(
      el('div', { class: 'banner-error', role: 'alert' }, [
        el('span', { class: 'banner-error-text', text: message }),
        el('div', { class: 'banner-error-actions' }, [
          el('button', {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => { restoreError(message); refresh(); },
            text: t('state.retry'),
          }),
          dismissButton(message, render),
        ]),
      ]),
    );
  }

  if (state.tab === 'privacy') {
    body.appendChild(renderPrivacyTab(state.data.loginEvents));
    return;
  }

  if (state.tab === 'analytics') {
    const node = renderAnalyticsTab(state.data, state.config, state.gradeTargets, setGradeTarget, { get: () => state.whatIf, set: setWhatIf, clear: clearWhatIf });
    body.appendChild(node);
    if (state.config.chartMode === 'echarts') mountAnalyticsCharts(node, { dark: isDarkTheme() });
    return;
  }

  if (state.tab === 'calendar' && activeCalendarView() === 'grid') {
    body.appendChild(renderCalendarGrid(state, {
      onMonthChange: (delta) => setCalendarViewMonth(state.calendarViewMonth.year, state.calendarViewMonth.month + delta),
      onToday: () => {
        const now = new Date();
        setCalendarViewMonth(now.getFullYear(), now.getMonth());
        setCalendarSelectedDate(isoOf(now));
      },
      onSelectDay: (iso) => setCalendarSelectedDate(iso),
      onOpenDetail: (target) => openDetailFor(target),
      onRowContextMenu: (x, y, target) => openContextMenu(x, y, menuItemsFor(target)),
      onDayContextMenu: (x, y, cell) => openContextMenu(x, y, dayContextMenuItems(cell)),
      onAddReminder: (iso) => openReminderForm(iso),
      onDeleteReminder: deleteReminderWithUndo,
    }, { fresh: freshView }));
    return;
  }

  if (state.tab === 'overview') {
    const summary = overviewSummary(state.data);
    body.appendChild(renderOverviewStats(summary, setTab, {
      notebook,
      draw: freshView,
      grade: overallGrade(state.data, state.config.gradingScale),
      onPickScale: (x, y) => openContextMenu(x, y, GRADING_SCALES.map((scale) => ({
        icon: scale === state.config.gradingScale ? 'check' : null,
        label: t(`grade.scale.${scale}`),
        hint: t(`grade.scale.${scale}.hint`),
        action: () => setConfig({ gradingScale: scale }),
      }))),
    }));
    body.appendChild(renderActivityFeed(state.data.activity, state.data.loginEvents));
  }
  if (state.tab === 'attendance' && notebook && state.data.attendance.length) {
    body.appendChild(renderAttendanceTally(state.data.attendance, { draw: freshView }));
  }

  const kinds = rowKindsForCurrentTab();
  if (kinds.length === 0) {
    body.appendChild(emptyState(t('state.nothingHere'), { notebook, draw: freshView }));
    return;
  }

  let itemCounter = -1;
  let swipeCount = 0;
  const list = el('div', { class: notebook && state.tab === 'announcements' ? 'row-list corkboard' : 'row-list' });
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
      list.appendChild(
        kind.today
          ? el('div', { class: 'row-section row-section-today' }, [el('span', { class: 'row-section-mark', text: kind.label })])
          : el('div', { class: 'row-section' }, [
            el('span', { text: kind.label }),
            kind.hint ? el('span', { class: 'row-section-hint', tabindex: '0', title: kind.hint, 'aria-label': kind.hint, text: '?' }) : null,
          ]),
      );
    } else if (kind.type === 'subheader') {
      (activeGroup ?? list).appendChild(el('div', { class: 'row-section row-subsection', text: kind.label }));
    } else if (kind.type === 'now') {
      // The calendar list's "you are here" line between past and upcoming
      // days. Notebook-only: the plain list already marks today's header.
      activeGroup = null;
      if (notebook) {
        list.appendChild(
          el('div', { class: 'agenda-now' }, [
            el('span', { class: 'margin-note', text: t('calendar.youAreHere') }),
            sketchSvg([sketchLine(0, 3, 100, 3, seededRandom('agenda-now'), { bow: 1, jitter: 0.8 })], { viewBox: [100, 6], stretch: true, evenStroke: true, className: 'sketch-now-line' }),
          ]),
        );
      }
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
          isGood ? doneCheck('caught-up', freshView) : null,
          el('span', { text: kind.text }),
        ]),
      );
    } else if (kind.type === 'info') {
      (activeGroup ?? list).appendChild(renderInfoRow(state.data));
    } else if (kind.type === 'item') {
      itemCounter += 1;
      // Captured per row: the click handler below runs long after this loop
      // has finished, when itemCounter itself holds the last row's index.
      const rowIndex = itemCounter;
      const isSelected = rowIndex === state.selectedIndex;
      const target = kind.target;
      // Notebook marks on done rows draw in when the view is fresh or their
      // collapsed section was just opened, not on every rebuild.
      const revealing = freshView || !!activeGroup?.classList.contains('reveal-pending');
      const rowBtn = el(
        'button',
        {
          class: `row-item ${isSelected ? 'selected' : ''} ${kind.done ? 'row-item-done' : ''} ${kind.past ? 'row-item-past' : ''}`,
          type: 'button',
          'data-kind': target.kind,
          onclick: () => openDetailFor(target, rowIndex),
          oncontextmenu: (e) => {
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, rowMenuItems(target));
          },
          // The keyboard's menu key (and its Shift+F10 fallback) opens the
          // same context menu mouse right-click does, anchored under the
          // focused row instead of a pointer position that doesn't exist.
          onkeydown: (e) => {
            if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            openContextMenu(rect.left, rect.bottom, rowMenuItems(target));
          },
        },
        [
          kind.done ? doneCheck(`${target.kind}:${target.index}`, revealing) : null,
          renderItemBody(target, state.data, state.ownUserId),
        ],
      );
      const menuButton = el(
        'button',
        {
          class: 'btn-icon row-actions-button',
          type: 'button',
          'aria-label': t('menu.actionsFor', { title: rowBtn.querySelector('.row-title')?.textContent ?? tabTitle(state.tab) }),
          title: t('menu.moreActions'),
          onclick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openContextMenu(rect.right, rect.bottom, rowMenuItems(target));
          },
        },
        [svgIcon(iconPaths('more'))],
      );
      if ((kind.done || kind.past) && notebook) {
        rowBtn.querySelector('.row-title')?.appendChild(
          sketchSvg([sketchLine(0, 5, 100, 5, seededRandom(`strike:${target.kind}:${target.index ?? target.reminder?.id}`), { bow: 1.2, overshoot: 3, jitter: 1.5 })], { viewBox: [100, 10], stretch: true, draw: revealing, className: 'sketch-strike' }),
        );
      }
      // Notebook calendar list: this week's items swiped in a highlighter
      // colored by kind, swiping in one after another on a fresh visit.
      if (kind.soon && notebook) {
        const title = rowBtn.querySelector('.row-title');
        if (title) {
          title.classList.add('hl-swipe', `hl-${target.kind}`);
          if (freshView) {
            title.classList.add('hl-swipe-in');
            title.style.setProperty('--i', String(swipeCount));
          }
          swipeCount += 1;
        }
      }
      (activeGroup ?? list).appendChild(el('div', { class: 'row-entry' }, [rowBtn, menuButton]));
    }
  }
  body.appendChild(list);
  const loadMoreNode = renderLoadMore(state.tab, { refocus: focusWasOnLoadMore });
  if (loadMoreNode) body.appendChild(loadMoreNode);
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


subscribe(render);
onLocaleChange(render);
installGlobalKeyboard();
window.matchMedia('(max-width: 640px)').addEventListener('change', render);

if (isLoggedIn()) {
  afterLogin().catch((err) => showToast(err.message, 'bad'));
}
// Wait for the active locale's strings before the first paint so the login
// screen never flashes raw translation keys; subsequent locale switches are
// instant since every locale's fetch already kicked off in i18n.js.
i18nReady.then(render);
