// Hand-drawn marks for the optional Notebook style (Settings → Appearance →
// Style; see NOTEBOOK_STYLE.md). Every generator takes a seeded `rand` so the
// same seed always yields the same wobble: renderBody() rebuilds the DOM on
// every state change, and freshly random strokes would visibly jitter on each
// rebuild.
//
// The path generators are pure (no DOM) so the test suite can run them under
// plain Node. sketchSvg() at the bottom is the only part that touches
// `document`, and only when called.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** cyrb53-style string hash, folded to a 32-bit seed. */
function hashSeed(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/** Seeded PRNG (mulberry32). Accepts a number or any string key — e.g. the
 * iso date a mark belongs to — and returns a function yielding [0, 1). */
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n) => Math.round(n * 100) / 100;
const pt = (x, y) => `${round(x)} ${round(y)}`;
const spread = (rand, amount) => (rand() * 2 - 1) * amount;

/** Catmull-Rom through `points`, emitted as one smooth cubic Bézier path. */
function smoothPath(points) {
  let d = `M ${pt(...points[0])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${pt(...c1)}, ${pt(...c2)}, ${pt(...p2)}`;
  }
  return d;
}

/** A ruled pen stroke from (x1, y1) to (x2, y2).
 * - bow: how far the stroke may belly out sideways (mostly one direction,
 *   the way a hand drifts, rather than an S-curve).
 * - overshoot: how far past each endpoint the pen may run on.
 * - jitter: how far off-line each end may start/land. */
export function sketchLine(x1, y1, x2, y2, rand, { bow = 2, overshoot = 0, jitter = 0 } = {}) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nx = -uy;
  const ny = ux;

  const startOver = overshoot * (0.3 + 0.7 * rand());
  const endOver = overshoot * (0.3 + 0.7 * rand());
  const startOff = spread(rand, jitter);
  const endOff = spread(rand, jitter);
  const sx = x1 - ux * startOver + nx * startOff;
  const sy = y1 - uy * startOver + ny * startOff;
  const ex = x2 + ux * endOver + nx * endOff;
  const ey = y2 + uy * endOver + ny * endOff;

  const bow1 = spread(rand, bow);
  const bow2 = bow1 * (0.3 + 0.7 * rand()) + spread(rand, bow * 0.35);
  const c1 = [sx + (ex - sx) / 3 + nx * bow1, sy + (ey - sy) / 3 + ny * bow1];
  const c2 = [sx + (2 * (ex - sx)) / 3 + nx * bow2, sy + (2 * (ey - sy)) / 3 + ny * bow2];
  return `M ${pt(sx, sy)} C ${pt(...c1)}, ${pt(...c2)}, ${pt(ex, ey)}`;
}

/** A pen loop around (cx, cy): one quick, slightly tilted pass that runs a
 * little past a full turn and spirals outward, so the tail overlaps the
 * start instead of closing neatly like a drawn ellipse would. */
export function sketchCircle(cx, cy, rx, ry, rand, { turns = 1.1, wobble = 0.05 } = {}) {
  const start = rand() * Math.PI * 2;
  const sweep = (turns + spread(rand, 0.06)) * Math.PI * 2;
  const tilt = spread(rand, 0.2);
  const phase = rand() * Math.PI * 2;
  const steps = Math.ceil(sweep / (Math.PI / 10));
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start + sweep * t;
    const k = 0.94 + 0.1 * t + wobble * Math.sin(angle * 2 + phase);
    const px = Math.cos(angle) * rx * k;
    const py = Math.sin(angle) * ry * k;
    points.push([cx + px * cos - py * sin, cy + px * sin + py * cos]);
  }
  return smoothPath(points);
}

/** A hand-drawn rectangle: four separate strokes (top, right, bottom, left)
 * whose corners cross rather than meet. Separate so they can draw in turn. */
export function sketchBox(x, y, w, h, rand, opts = {}) {
  return [
    sketchLine(x, y, x + w, y, rand, opts),
    sketchLine(x + w, y, x + w, y + h, rand, opts),
    sketchLine(x + w, y + h, x, y + h, rand, opts),
    sketchLine(x, y + h, x, y, rand, opts),
  ];
}

/** Rules a cols × rows grid of `cell`-sized squares: one full-length stroke
 * per column edge, then per row edge, each running a little past the border
 * like a hand-ruled table. */
export function sketchGrid(cols, rows, rand, { cell = 100, bow = 3, overshoot = 5, jitter = 1.5 } = {}) {
  const w = cols * cell;
  const h = rows * cell;
  const opts = { bow, overshoot, jitter };
  const paths = [];
  for (let c = 0; c <= cols; c++) paths.push(sketchLine(c * cell, 0, c * cell, h, rand, opts));
  for (let r = 0; r <= rows; r++) paths.push(sketchLine(0, r * cell, w, r * cell, rand, opts));
  return paths;
}

/** A check mark filling a size × size box at (x, y): a short down-stroke into
 * a longer, slightly curved up-stroke, in one path. */
export function sketchTick(x, y, size, rand) {
  const j = size * 0.06;
  const p0 = [x + spread(rand, j), y + size * 0.55 + spread(rand, j)];
  const p1 = [x + size * 0.38 + spread(rand, j), y + size * 0.92 + spread(rand, j)];
  const p2 = [x + size + spread(rand, j), y + size * 0.08 + spread(rand, j)];
  const q0 = [(p0[0] + p1[0]) / 2 + spread(rand, j), (p0[1] + p1[1]) / 2 + spread(rand, j)];
  const q1 = [(p1[0] + p2[0]) / 2 - size * 0.05, (p1[1] + p2[1]) / 2 + size * 0.03];
  return `M ${pt(...p0)} Q ${pt(...q0)} ${pt(...p1)} Q ${pt(...q1)} ${pt(...p2)}`;
}

/** A one-stroke five-pointed star, the kind doodled in a margin: the pen
 * visits every other point and lands a little off where it started. */
export function sketchStar(cx, cy, r, rand) {
  const start = -Math.PI / 2 + spread(rand, 0.15);
  const points = [];
  for (let k = 0; k <= 5; k++) {
    const angle = start + (k * 4 * Math.PI) / 5;
    const rr = r * (1 + spread(rand, 0.08));
    points.push([cx + Math.cos(angle) * rr + spread(rand, r * 0.04), cy + Math.sin(angle) * rr + spread(rand, r * 0.04)]);
  }
  return `M ${points.map((p) => pt(...p)).join(' L ')}`;
}

/** A spiral doodle winding outward from (cx, cy) to radius r. */
export function sketchSpiral(cx, cy, r, rand, { turns = 2.25 } = {}) {
  const start = rand() * Math.PI * 2;
  const steps = Math.ceil(turns * 16);
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start + t * turns * Math.PI * 2;
    const rr = r * t * (1 + spread(rand, 0.05));
    points.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr]);
  }
  return smoothPath(points);
}

/** A doodled face for a 1–5 mood (1 rough … 5 great) in a 40 × 40 box:
 * head, two eyes, and a mouth that bends from a frown through a flat line
 * to a grin; 5 gets an open, D-shaped smile. */
export function sketchFace(mood, rand) {
  const m = Math.min(5, Math.max(1, Math.round(mood)));
  const head = sketchCircle(20, 20, 16, 15, rand, { turns: 1.06 });
  const eye = (x) => sketchLine(x, 14, x + 0.4, 17.5, rand, { bow: 0.3, jitter: 0.4 });
  const curve = (m - 3) * 2.6; // > 0 smiles, < 0 frowns
  const mouthY = 27 - curve * 0.35;
  const mouth = m === 5
    ? `M ${pt(12.5, 24.5)} Q ${pt(20, 33 + spread(rand, 0.6))} ${pt(27.5, 24.5)} Z`
    : `M ${pt(13 + spread(rand, 0.5), mouthY)} Q ${pt(20, mouthY + curve * 1.6 + spread(rand, 0.4))} ${pt(27 + spread(rand, 0.5), mouthY + spread(rand, 0.3))}`;
  return [head, eye(14.5), eye(25.5), mouth];
}

/** Splits a count into tally groups of five: 12 → [5, 5, 2]. */
export function tallyGroups(count) {
  const groups = [];
  for (let left = Math.max(0, Math.floor(count)); left > 0; left -= 5) groups.push(Math.min(5, left));
  return groups;
}

/** One tally group of 1–5 marks in a 30 × 24 box: up to four upright
 * strokes, with the fifth slashed across them. */
export function sketchTallyGroup(n, rand) {
  const paths = [];
  for (let i = 0; i < Math.min(n, 4); i++) {
    const x = 5 + i * 6;
    paths.push(sketchLine(x + spread(rand, 0.6), 3, x + spread(rand, 0.8), 21, rand, { bow: 0.8, jitter: 0.5 }));
  }
  if (n >= 5) paths.push(sketchLine(1, 17, 27, 6, rand, { bow: 1.2, overshoot: 1, jitter: 1 }));
  return paths;
}

/** A quick pen arrow from (x1, y1) to (x2, y2): the shaft, then a two-barb
 * head as a second stroke through the tip. */
export function sketchArrow(x1, y1, x2, y2, rand, { head = 5 } = {}) {
  // No end jitter: the head is drawn through (x2, y2), so the shaft has to
  // land exactly there or the two strokes visibly miss each other.
  const shaft = sketchLine(x1, y1, x2, y2, rand, { bow: 1.5 });
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const barb = (side) => {
    const a = angle + Math.PI + side * (0.5 + spread(rand, 0.08));
    return [x2 + Math.cos(a) * head, y2 + Math.sin(a) * head];
  };
  return [shaft, `M ${pt(...barb(-1))} L ${pt(x2, y2)} L ${pt(...barb(1))}`];
}

/** A folded paper plane pointing right in a 40 × 28 box: its outline, then
 * the center fold. */
export function sketchPlane(rand) {
  const j = () => spread(rand, 0.5);
  const nose = [38 + j(), 12 + j()];
  const tail = [3 + j(), 4 + j()];
  const wing = [12 + j(), 25 + j()];
  const fold = [15 + j(), 15 + j()];
  return [`M ${pt(...tail)} L ${pt(...nose)} L ${pt(...wing)} L ${pt(...fold)} Z`, `M ${pt(...fold)} L ${pt(...nose)}`];
}

/** Wraps sketched paths in an aria-hidden, absolutely positioned SVG (see
 * .sketch in styles.css; position and size come from `className`).
 * - viewBox: [w, h] in the paths' own units.
 * - stretch: fill a box of varying size (a grid, a day cell) by scaling
 *   non-uniformly. Leave off for marks that must stay round (circles).
 * - evenStroke: keep a constant screen stroke width while stretched
 *   (vector-effect: non-scaling-stroke). Such marks never draw in: with
 *   non-scaling strokes Chromium measures dashes in screen space, so the
 *   pathLength-normalized draw-in would stop short, leaving strokes
 *   half-drawn. Ignoring `draw` (rather than the stroke mode) keeps a mark
 *   looking the same whether or not this particular render animates.
 * - draw: each stroke draws itself in, in order (.sketch-draw).
 * - drawOffset: strokes to wait before this mark's first one, so a row of
 *   separate marks (tally groups) can draw one after another. */
export function sketchSvg(paths, { viewBox, stretch = false, evenStroke = false, draw = false, drawOffset = 0, className = '' }) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', ['sketch', evenStroke && 'sketch-even', className].filter(Boolean).join(' '));
  svg.setAttribute('viewBox', `0 0 ${viewBox[0]} ${viewBox[1]}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (stretch) svg.setAttribute('preserveAspectRatio', 'none');

  // Strokes live in one <g> so the chalk filter runs once per mark, and on
  // SVG content rather than the <svg> box (url() filters on HTML-level boxes
  // are patchy across browsers).
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'sketch-strokes');
  paths.forEach((d, i) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (draw && !evenStroke) {
      path.setAttribute('pathLength', '1');
      path.setAttribute('class', 'sketch-draw');
      path.style.setProperty('--i', String(drawOffset + i));
    }
    group.appendChild(path);
  });
  svg.appendChild(group);
  return svg;
}
