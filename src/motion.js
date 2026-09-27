const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const LEAVE_FALLBACK_MS = 400;
const STAGGER_LIMIT = 12;
const STAGGERED = '.stat-grid > *, :is(.row-list, .section-items) > :not(.section-items)';

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const prefersReducedMotion = () => reducedMotion.matches;

export function leave(node, { onDone = () => node.remove(), waitOn = node } = {}) {
  if (!node || node.classList.contains('is-leaving')) return () => {};
  node.inert = true;
  node.classList.add('is-leaving');
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onDone();
  };
  const cancel = () => {
    settled = true;
    node.inert = false;
    node.classList.remove('is-leaving');
  };
  const running = prefersReducedMotion() ? [] : [
    ...node.getAnimations({ subtree: true }),
    ...(waitOn === node ? [] : waitOn.getAnimations()),
  ].filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity);
  if (!running.length) {
    finish();
    return cancel;
  }
  Promise.all(running.map((animation) => animation.finished)).then(finish, finish);
  setTimeout(finish, LEAVE_FALLBACK_MS);
  return cancel;
}

export function clearSettled(container) {
  for (const child of [...container.children]) {
    if (!child.classList.contains('is-leaving')) child.remove();
  }
}

export function flip(nodes, mutate, { duration = 320 } = {}) {
  const before = new Map(nodes.map((node) => [node, node.getBoundingClientRect()]));
  mutate();
  if (prefersReducedMotion()) return;
  for (const [node, was] of before) {
    if (!node.isConnected) continue;
    const now = node.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (!dx && !dy) continue;
    node.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration, easing: EASE_OUT, composite: 'add' });
  }
}

export function enterView(container) {
  if (prefersReducedMotion()) return;
  const staggered = [...container.querySelectorAll(STAGGERED)].slice(0, STAGGER_LIMIT);
  staggered.forEach((node, index) => {
    node.style.setProperty('--enter-i', String(index));
    node.classList.add('enter-stagger');
  });
  for (const child of container.children) {
    if (!staggered.some((node) => child.contains(node))) child.classList.add('enter-view');
  }
}
