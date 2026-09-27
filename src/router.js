import { state, subscribe, notify, isLoggedIn, setTab } from './state.js';
import { TAB_IDS, detailFields } from './rows.js';
import { routeOf, historyStep, tabFromHash, hashFor } from './route.js';

const POP_TIMEOUT_MS = 400;

let awaitingPop = false;

const urlFor = (route) => `${location.pathname}${location.search}${hashFor(route)}`;
const writeEntry = (method, route, from) => history[method]({ route, from }, '', urlFor(route));
const withoutOverlay = (route) => ({ ...route, overlay: null, detail: null, stack: [], params: null });

function stepBack() {
  awaitingPop = true;
  history.back();
  setTimeout(settlePop, POP_TIMEOUT_MS);
}

function settlePop() {
  if (!awaitingPop) return;
  awaitingPop = false;
  sync();
}

function sync() {
  if (awaitingPop) return;
  const next = routeOf(state);
  const entry = history.state?.route ? history.state : null;
  const step = entry ? historyStep(entry, next) : 'replace';
  if (step === 'none') return;
  if (step === 'back' && isLoggedIn()) return stepBack();
  if (step === 'push' && isLoggedIn()) return writeEntry('pushState', next, entry.route);
  writeEntry('replaceState', next, entry?.from ?? null);
}

function detailStillExists(route) {
  try {
    return !!detailFields(route.detail, state.data);
  } catch {
    return false;
  }
}

function apply(route) {
  if (route.tab !== state.tab) state.selectedIndex = -1;
  state.tab = route.tab;
  state.mobileNavOpen = false;
  state.activeOverlay = route.overlay;
  state.detailTarget = route.detail;
  state.detailBackStack = [...route.stack];
  state.composePrefill = null;
  state.reminderPrefill = null;
  Object.assign(state, route.params);
  notify();
}

function onPopState(event) {
  if (awaitingPop) return settlePop();
  const entry = event.state?.route ? event.state : null;
  const hashTab = tabFromHash(location.hash, TAB_IDS) ?? state.tab;
  let route = entry?.route ?? withoutOverlay({ ...routeOf(state), tab: hashTab });
  if (route.overlay === 'detail' && !detailStillExists(route)) route = withoutOverlay(route);
  if (route !== entry?.route) writeEntry('replaceState', route, null);
  apply(route);
}

function onLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('a[href^="#/"]');
  const tab = link && !link.target ? tabFromHash(link.getAttribute('href'), TAB_IDS) : null;
  if (!tab) return;
  event.preventDefault();
  setTab(tab);
}

export function installRouter() {
  const linkedTab = tabFromHash(location.hash, TAB_IDS);
  if (linkedTab) state.tab = linkedTab;
  writeEntry('replaceState', routeOf(state), null);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('click', onLinkClick);
  subscribe(sync);
}
