// Never add an innerHTML/html escape hatch here — every string must land as
// textContent so database content (messages, notes) can't execute as markup.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgIcon(paths, viewBox = '0 0 24 24') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(root, node) {
  clear(root);
  root.appendChild(node);
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((n) => n.offsetParent !== null);
}

/** Moves focus to the first focusable element inside `container` (falling
 * back to the container itself). Used when a modal overlay opens so keyboard
 * and screen-reader users land inside it instead of on whatever was focused
 * behind it. */
export function focusFirstIn(container) {
  if (!container) return;
  const [first] = focusableIn(container);
  (first || container).focus();
}

/** Keeps Tab/Shift+Tab cycling within `container` instead of leaking focus
 * out to the dimmed page behind a modal overlay. Call from a keydown
 * listener with the Tab KeyboardEvent; no-ops for any other key. */
export function trapTabKey(e, container) {
  if (e.key !== 'Tab' || !container) return;
  const items = focusableIn(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!items.includes(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
