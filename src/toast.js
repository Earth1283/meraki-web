import { el } from './dom.js';
import { state } from './state.js';
import { seededRandom, sketchPlane, sketchSvg } from './sketch.js';
import { leave, flip } from './motion.js';

const toastRoot = document.getElementById('toast-root');

// `action` (optional: { label, onClick }) adds a button to the toast — e.g.
// "Undo" on a destructive-but-recoverable action — so the toast doubles as
// the confirmation and the recovery path instead of needing a separate
// "are you sure?" dialog before the action happens.
export function showToast(text, kind = 'ok', action = null, { flourish = null, duration = null } = {}) {
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    leave(node, { onDone: () => flip(otherToasts(), () => node.remove()) });
  };
  // Notebook style's "passing a note": a paper plane draws itself in on the
  // toast, then flies off it.
  const plane = flourish === 'plane' && state.config.style === 'notebook'
    ? sketchSvg(sketchPlane(seededRandom('toast-plane')), { viewBox: [40, 28], draw: true, className: 'sketch-plane' })
    : null;
  const node = el('div', { class: `toast ${kind}${plane ? ' toast-with-plane' : ''}` }, [
    plane,
    el('span', { class: 'toast-text', text }),
    action ? el('button', { class: 'toast-action', type: 'button', onclick: () => { dismiss(); action.onClick(); } }, action.label) : null,
  ]);
  const otherToasts = () => [...toastRoot.children].filter((toast) => toast !== node);
  flip(otherToasts(), () => toastRoot.appendChild(node));
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(dismiss, duration ?? (action ? 5000 : 3200));
}
