const HISTORYLESS_OVERLAYS = new Set(['palette']);

export const OVERLAY_PARAMS = {
  compose: ['composePrefill'],
  reminder: ['reminderPrefill'],
  turnin: ['turnInAssignmentId', 'turnInReturn'],
  quiz: ['quizAssessmentId', 'quizReturn'],
};

export function routeOf(state) {
  const overlay = HISTORYLESS_OVERLAYS.has(state.activeOverlay) ? null : state.activeOverlay ?? null;
  const keys = OVERLAY_PARAMS[overlay] ?? [];
  return {
    tab: state.tab,
    overlay,
    detail: overlay === 'detail' ? state.detailTarget : null,
    stack: overlay === 'detail' ? [...state.detailBackStack] : [],
    params: keys.length ? Object.fromEntries(keys.map((key) => [key, state[key] ?? null])) : null,
  };
}

export const sameRoute = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function tabFromHash(hash, tabIds) {
  const id = decodeURIComponent(hash.replace(/^#\/?/, '').split('/')[0]);
  return tabIds.includes(id) ? id : null;
}

export const hashFor = (route) => `#/${encodeURIComponent(route.tab)}`;

export function isStepForward(from, to) {
  if (from.tab !== to.tab) return true;
  if (!from.overlay) return !!to.overlay;
  if (from.overlay === 'detail' && to.overlay && to.overlay !== 'detail') return true;
  return from.overlay === 'detail' && to.overlay === 'detail' && to.stack.length > from.stack.length;
}

export function historyStep(entry, next) {
  if (sameRoute(entry.route, next)) return 'none';
  if (entry.from && sameRoute(entry.from, next)) return 'back';
  return isStepForward(entry.route, next) ? 'push' : 'replace';
}
