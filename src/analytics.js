import { el, svgIcon } from './dom.js';
import { t } from './i18n.js';
import { pctClass, pill, emptyState, gradeCircle } from './rows.js';
import { seededRandom, sketchArrow, sketchSvg } from './sketch.js';
import { iconPaths } from './icons.js';
import { renderWhatIf, renderWhatIfGpa } from './whatif.js';
import { gradeSetup, classPercent, countedPoints, isExtraCredit } from './gradebook.js';
import { markCode } from './marks.js';

export const DEFAULT_TARGET_PCT = 90;

/** A class's grade and what feeds it, worked out the way the official site
 * does (see gradebook.js). `lowPct` and `highPct` are where the grade ends up
 * if every ungraded assignment scores nothing or full marks; the target
 * projection works from those. Ungraded extra credit isn't work anyone has
 * to do, so it's left out of both. */
export function classGradeStats(data, classId) {
  const setup = gradeSetup(data.classes.find((c) => c.id === classId)?.weights);
  const assignments = data.assignments.filter((a) => a.class_id === classId && a.points_possible != null);
  // A grade counts once it has points or a mark. What-if grades come after
  // the real ones, so a real grade always wins.
  const gradeFor = (assignmentId) => data.grades.find((g) => g.assignment_id === assignmentId && (g.points_earned != null || markCode(g.comment))) ?? null;

  const graded = [];
  const remaining = [];
  let earnedPoints = 0;
  let gradedPossible = 0;
  let remainingPossible = 0;
  const categoryTotals = new Map();

  for (const a of assignments) {
    const g = gradeFor(a.id);
    const entry = { category: a.category, pointsPossible: Number(a.points_possible), pointsEarned: g?.points_earned == null ? null : Number(g.points_earned), markCode: markCode(g?.comment) };
    if (!g) {
      if (!isExtraCredit(a.category)) {
        remaining.push(entry);
        remainingPossible += entry.pointsPossible;
      }
      continue;
    }
    const earned = countedPoints(entry, setup.marks);
    // Excused: it counts for nothing, now or later.
    if (earned == null) continue;
    graded.push({ entry, date: g.updated_at });
    earnedPoints += earned;
    if (!isExtraCredit(a.category)) gradedPossible += entry.pointsPossible;
    const cat = a.category || t('label.category');
    const totals = categoryTotals.get(cat) ?? { earned: 0, possible: 0 };
    totals.earned += earned;
    totals.possible += entry.pointsPossible;
    categoryTotals.set(cat, totals);
  }

  const entries = graded.map((g) => g.entry);
  graded.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  const trend = graded
    .map((g, i) => ({ date: g.date, pct: classPercent(graded.slice(0, i + 1).map((x) => x.entry), setup) }))
    .filter((point) => point.pct != null);

  const categoryBreakdown = [...categoryTotals.entries()]
    .filter(([, { possible }]) => possible > 0)
    .map(([category, { earned, possible }]) => ({ category, earned, possible, pct: (earned / possible) * 100 }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const currentPct = classPercent(entries, setup);
  const withRemainingAt = (share) => classPercent([...entries, ...remaining.map((e) => ({ ...e, pointsEarned: e.pointsPossible * share }))], setup);
  return {
    currentPct,
    lowPct: remaining.length ? withRemainingAt(0) : currentPct,
    highPct: remaining.length ? withRemainingAt(1) : currentPct,
    earnedPoints,
    gradedPossible,
    remainingPossible,
    totalAssignments: assignments.length,
    categoryBreakdown,
    trend,
  };
}

/** What it takes to reach `targetPct`: the average needed on the remaining
 * work, or whether the target is already locked in or out of reach. The
 * grade moves in a straight line between the remaining work scoring nothing
 * (lowPct) and full marks (highPct), in weighted classes too. */
export function targetProjection(stats, targetPct) {
  const { currentPct, remainingPossible, lowPct, highPct } = stats;
  const diffFromCurrent = currentPct != null ? targetPct - currentPct : null;
  if (remainingPossible <= 0 || lowPct == null || highPct == null || highPct <= lowPct) {
    return { status: 'final', diffFromCurrent, requiredAvgPct: null, maxAchievablePct: highPct ?? currentPct };
  }
  const requiredAvgPct = ((targetPct - lowPct) / (highPct - lowPct)) * 100;
  const status = requiredAvgPct <= 0 ? 'guaranteed' : requiredAvgPct > 100 ? 'unreachable' : 'onTrack';
  return { status, diffFromCurrent, requiredAvgPct, maxAchievablePct: highPct };
}

function projectionMessage(stats, projection, targetPct) {
  if (stats.totalAssignments === 0) return { text: t('analytics.noAssignmentsYet'), cls: 'dim' };
  if (projection.status === 'final') {
    if (stats.currentPct == null) return { text: t('analytics.noGradesYet'), cls: 'dim' };
    return { text: t('analytics.status.final'), cls: pctClass(stats.currentPct) };
  }
  if (projection.status === 'guaranteed') return { text: t('analytics.status.guaranteed', { target: targetPct }), cls: 'good' };
  if (projection.status === 'unreachable') return { text: t('analytics.status.unreachable', { max: projection.maxAchievablePct.toFixed(0) }), cls: 'bad' };
  return { text: t('analytics.status.onTrack', { pct: projection.requiredAvgPct.toFixed(0), target: targetPct }), cls: 'accent' };
}

function diffPill(diffFromCurrent, { notebook = false, seed = '' } = {}) {
  if (diffFromCurrent == null) return null;
  const rounded = Math.round(diffFromCurrent * 10) / 10;
  const [text, cls] = rounded <= 0
    ? [t('analytics.diff.above', { diff: Math.abs(rounded).toFixed(1) }), 'good']
    : [t('analytics.diff.below', { diff: rounded.toFixed(1) }), 'warn'];
  if (!notebook) return pill(text, cls);
  // Notebook style: a note scribbled in the margin, arrow pointing back at
  // the status line it annotates.
  return el('span', { class: `margin-note text-${cls}` }, [
    sketchSvg(sketchArrow(22, 4, 2, 10, seededRandom(`note-arrow:${seed}`)), { viewBox: [24, 14], className: 'sketch-note-arrow' }),
    el('span', { text }),
  ]);
}

function emptyNote(text) {
  return el('div', { class: 'analytics-empty-note', text });
}

function renderMeter(label, pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  return el('div', { class: 'analytics-meter' }, [
    el('div', { class: 'analytics-meter-top' }, [
      el('span', { class: 'analytics-meter-label', text: label }),
      el('span', { class: `analytics-meter-pct text-${pctClass(pct)}`, text: `${pct.toFixed(0)}%` }),
    ]),
    el('div', { class: 'analytics-meter-track' }, [el('div', { class: `analytics-meter-fill fill-${pctClass(pct)}`, style: `width:${clamped}%` })]),
  ]);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function renderSparkline(trend) {
  if (trend.length < 2) return emptyNote(t('analytics.noTrendData'));

  const w = 200;
  const h = 44;
  const pad = 4;
  const pcts = trend.map((p) => p.pct);
  const min = Math.min(...pcts, 0);
  const max = Math.max(...pcts, 100);
  const range = max - min || 1;
  const points = trend
    .map((p, i) => {
      const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.pct - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'analytics-sparkline');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points);
  svg.appendChild(line);
  return svg;
}

function lineSpecFor(trend) {
  return {
    dates: trend.map((p) => (p.date ? p.date.slice(0, 10) : '')),
    pcts: trend.map((p) => Math.round(p.pct * 10) / 10),
  };
}

function barSpecFor(rows) {
  return {
    labels: rows.map((r) => r.label),
    pcts: rows.map((r) => Math.round(r.pct * 10) / 10),
  };
}

// echarts needs a real pixel height per bar, so the container is sized to
// its row count instead of relying on a fixed CSS height like the line
// chart's.
function barChartHeight(rowCount) {
  return `${Math.max(1, rowCount) * 30 + 16}px`;
}

function targetInput(classId, targetPct, onTargetChange) {
  return el('input', {
    class: 'field-input analytics-target-input',
    type: 'number',
    min: '0',
    max: '100',
    step: '1',
    value: String(targetPct),
    onchange: (e) => {
      const n = Number(e.target.value);
      if (!Number.isFinite(n)) return;
      onTargetChange(classId, Math.min(100, Math.max(0, n)));
    },
  });
}

function renderClassCard(cls, data, config, targets, onTargetChange, whatIf, updaters) {
  const stats = classGradeStats(data, cls.id);
  const targetPct = targets[cls.id] ?? DEFAULT_TARGET_PCT;
  const projection = targetProjection(stats, targetPct);
  const msg = projectionMessage(stats, projection, targetPct);

  const notebook = config.style === 'notebook';
  const meta = [cls.subject, cls.teacher_name].filter(Boolean).join(' · ');

  const noWorkYet = stats.totalAssignments === 0;

  let trendSection;
  if (noWorkYet) trendSection = emptyNote(t('analytics.noAssignmentsYet'));
  else if (stats.trend.length < 2) trendSection = emptyNote(t('analytics.noTrendData'));
  else if (config.chartMode === 'echarts') {
    trendSection = el('div', { class: 'analytics-echart', 'data-chart-line': JSON.stringify(lineSpecFor(stats.trend)) });
  } else trendSection = renderSparkline(stats.trend);

  let categorySection;
  if (noWorkYet) categorySection = emptyNote(t('analytics.noAssignmentsYet'));
  else if (stats.categoryBreakdown.length === 0) categorySection = emptyNote(t('analytics.noGradesYet'));
  else if (config.chartMode === 'echarts') {
    const rows = stats.categoryBreakdown.map((c) => ({ label: c.category, pct: c.pct }));
    categorySection = el('div', {
      class: 'analytics-echart analytics-echart-bar',
      style: `height:${barChartHeight(rows.length)}`,
      'data-chart-bar': JSON.stringify(barSpecFor(rows)),
    });
  } else {
    categorySection = el(
      'div',
      { class: 'analytics-meter-list' },
      stats.categoryBreakdown.map((c) => renderMeter(c.category, c.pct)),
    );
  }

  return el('div', { class: 'analytics-card' }, [
    el('div', { class: 'analytics-card-header' }, [
      pill(cls.period != null ? `P${cls.period}` : null, 'accent'),
      el('div', { class: 'analytics-card-title' }, [el('div', { class: 'row-title', text: cls.name }), meta ? el('div', { class: 'row-meta', text: meta }) : null]),
      stats.currentPct == null
        ? pill(t('analytics.noGradesYet'), 'dim')
        : notebook
          ? el('span', { class: `grade-mark text-${pctClass(stats.currentPct)}`, text: `${stats.currentPct.toFixed(0)}%` }, [gradeCircle(`class:${cls.id}`)])
          : pill(`${stats.currentPct.toFixed(0)}%`, pctClass(stats.currentPct)),
    ]),
    el('div', { class: 'analytics-card-section' }, [el('div', { class: 'field-label', text: t('analytics.trend') }), trendSection]),
    el('div', { class: 'analytics-card-section' }, [el('div', { class: 'field-label', text: t('analytics.category') }), categorySection]),
    el('div', { class: 'analytics-target-row' }, [
      el('label', { class: 'field-label', text: t('analytics.target') }),
      targetInput(cls.id, targetPct, onTargetChange),
      el('div', { class: 'analytics-status-line' }, [el('span', { class: `analytics-status text-${msg.cls}`, text: msg.text }), diffPill(projection.diffFromCurrent, { notebook, seed: cls.id })]),
    ]),
    whatIf ? renderWhatIf(cls, data, config, whatIf, updaters) : null,
  ]);
}

function renderComparisonCard(data, config, whatIf, updaters) {
  const rows = data.classes
    .map((cls) => ({ label: cls.name, pct: classGradeStats(data, cls.id).currentPct }))
    .filter((r) => r.pct != null);

  let body;
  if (rows.length === 0) body = emptyNote(t('analytics.noComparisonData'));
  else if (config.chartMode === 'echarts') {
    body = el('div', {
      class: 'analytics-echart analytics-echart-bar',
      style: `height:${barChartHeight(rows.length)}`,
      'data-chart-bar': JSON.stringify(barSpecFor(rows)),
    });
  } else {
    body = el(
      'div',
      { class: 'analytics-meter-list' },
      rows.map((r) => renderMeter(r.label, r.pct)),
    );
  }

  // Once What if scores are entered anywhere: the GPA they'd add up to.
  const gpaLine = whatIf ? renderWhatIfGpa(data, config, whatIf, updaters) : null;

  return el('div', { class: 'analytics-card' }, [el('div', { class: 'field-label', text: t('analytics.comparison') }), body, gpaLine]);
}

/** `whatIf` ({ get, set, clear }, optional) adds the What if calculator to
 * each class card; see renderWhatIf. */
export function renderAnalyticsTab(data, config, targets, onTargetChange, whatIf = null) {
  if (data.classes.length === 0) {
    return emptyState(t('analytics.noClasses'), { notebook: config.style === 'notebook' });
  }
  const updaters = [];
  const node = el('div', { class: 'analytics-tab' }, [
    renderComparisonCard(data, config, whatIf, updaters),
    el(
      'div',
      { class: 'analytics-grid' },
      data.classes.map((cls) => renderClassCard(cls, data, config, targets, onTargetChange, whatIf, updaters)),
    ),
  ]);
  updaters.forEach((fn) => fn());
  return node;
}

export function chartModeToggle(config, onToggle) {
  const advanced = config.chartMode === 'echarts';
  return el(
    'button',
    {
      class: `btn-icon ${advanced ? 'active-toggle' : ''}`,
      type: 'button',
      'aria-label': advanced ? t('analytics.simpleCharts') : t('analytics.advancedCharts'),
      title: advanced ? t('analytics.simpleCharts') : t('analytics.advancedCharts'),
      onclick: () => onToggle(advanced ? 'simple' : 'echarts'),
    },
    [svgIcon(iconPaths('analytics'))],
  );
}

const ECHARTS_SRC = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js';
let echartsPromise = null;

function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!echartsPromise) {
    echartsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ECHARTS_SRC;
      script.onload = () => resolve(window.echarts);
      script.onerror = () => reject(new Error('echarts failed to load'));
      document.head.appendChild(script);
    });
  }
  return echartsPromise;
}

let chartInstances = [];

export function disposeAnalyticsCharts() {
  chartInstances.forEach((inst) => {
    try {
      inst.dispose();
    } catch {
      // instance may already be torn down with its container
    }
  });
  chartInstances = [];
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function mountLineChart(node, spec, echarts, dark, accent) {
  const inst = echarts.init(node, dark ? 'dark' : null, { renderer: 'svg' });
  inst.setOption({
    backgroundColor: 'transparent',
    grid: { left: 34, right: 12, top: 12, bottom: 22 },
    xAxis: { type: 'category', data: spec.dates, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' } },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
    series: [
      {
        type: 'line',
        data: spec.pcts,
        smooth: true,
        symbolSize: 6,
        lineStyle: { color: accent, width: 2 },
        itemStyle: { color: accent },
        areaStyle: { color: accent, opacity: 0.12 },
      },
    ],
  });
  chartInstances.push(inst);
}

function mountBarChart(node, spec, echarts, dark, colorFor) {
  const inst = echarts.init(node, dark ? 'dark' : null, { renderer: 'svg' });
  inst.setOption({
    backgroundColor: 'transparent',
    grid: { left: 96, right: 24, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' } },
    yAxis: { type: 'category', data: spec.labels, axisLabel: { fontSize: 10 } },
    tooltip: { valueFormatter: (v) => `${v}%` },
    series: [{ type: 'bar', data: spec.pcts.map((p) => ({ value: p, itemStyle: { color: colorFor(p) } })), barMaxWidth: 18 }],
  });
  chartInstances.push(inst);
}

export function mountAnalyticsCharts(root, { dark = false } = {}) {
  const lineNodes = root.querySelectorAll('[data-chart-line]');
  const barNodes = root.querySelectorAll('[data-chart-bar]');
  if (lineNodes.length === 0 && barNodes.length === 0) return;

  loadECharts()
    .then((echarts) => {
      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue('--accent').trim() || '#2563eb';
      const good = styles.getPropertyValue('--good').trim() || '#16a34a';
      const warn = styles.getPropertyValue('--warn').trim() || '#d97706';
      const bad = styles.getPropertyValue('--bad').trim() || '#dc2626';
      const colorFor = (pct) => (pct >= 90 ? good : pct >= 70 ? warn : bad);

      lineNodes.forEach((node) => {
        if (!node.isConnected) return;
        const spec = safeParse(node.dataset.chartLine);
        if (spec) mountLineChart(node, spec, echarts, dark, accent);
      });
      barNodes.forEach((node) => {
        if (!node.isConnected) return;
        const spec = safeParse(node.dataset.chartBar);
        if (spec) mountBarChart(node, spec, echarts, dark, colorFor);
      });
    })
    .catch(() => {
      [...lineNodes, ...barNodes].forEach((node) => {
        node.textContent = t('analytics.chartLoadError');
        node.classList.add('analytics-chart-error');
      });
    });
}
