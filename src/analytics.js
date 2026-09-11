import { el, svgIcon } from './dom.js';
import { t } from './i18n.js';
import { pctClass, pill } from './rows.js';
import { iconPaths } from './icons.js';

export const DEFAULT_TARGET_PCT = 90;

export function classGradeStats(data, classId) {
  const assignments = data.assignments.filter((a) => a.class_id === classId && a.points_possible != null);
  const gradeFor = (assignmentId) => data.grades.find((g) => g.assignment_id === assignmentId && g.points_earned != null) ?? null;

  let earnedPoints = 0;
  let gradedPossible = 0;
  let remainingPossible = 0;
  const categoryTotals = new Map();
  const trendEntries = [];

  for (const a of assignments) {
    const g = gradeFor(a.id);
    if (!g) {
      remainingPossible += a.points_possible;
      continue;
    }
    earnedPoints += g.points_earned;
    gradedPossible += a.points_possible;
    const cat = a.category || t('label.category');
    const totals = categoryTotals.get(cat) ?? { earned: 0, possible: 0 };
    totals.earned += g.points_earned;
    totals.possible += a.points_possible;
    categoryTotals.set(cat, totals);
    trendEntries.push({ date: g.updated_at, earned: g.points_earned, possible: a.points_possible });
  }

  trendEntries.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  let runEarned = 0;
  let runPossible = 0;
  const trend = trendEntries.map((e) => {
    runEarned += e.earned;
    runPossible += e.possible;
    return { date: e.date, pct: (runEarned / runPossible) * 100 };
  });

  const categoryBreakdown = [...categoryTotals.entries()]
    .map(([category, { earned, possible }]) => ({ category, earned, possible, pct: (earned / possible) * 100 }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    currentPct: gradedPossible > 0 ? (earnedPoints / gradedPossible) * 100 : null,
    earnedPoints,
    gradedPossible,
    remainingPossible,
    totalAssignments: assignments.length,
    categoryBreakdown,
    trend,
  };
}

export function targetProjection(stats, targetPct) {
  const { earnedPoints, gradedPossible, remainingPossible, currentPct } = stats;
  const diffFromCurrent = currentPct != null ? targetPct - currentPct : null;

  if (remainingPossible <= 0) {
    return { status: 'final', diffFromCurrent, requiredAvgPct: null, maxAchievablePct: currentPct };
  }

  const totalPossible = gradedPossible + remainingPossible;
  const requiredAvgPct = ((targetPct / 100) * totalPossible - earnedPoints) / remainingPossible * 100;
  const maxAchievablePct = ((earnedPoints + remainingPossible) / totalPossible) * 100;

  const status = requiredAvgPct <= 0 ? 'guaranteed' : requiredAvgPct > 100 ? 'unreachable' : 'onTrack';
  return { status, diffFromCurrent, requiredAvgPct, maxAchievablePct };
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

function diffPill(diffFromCurrent) {
  if (diffFromCurrent == null) return null;
  const rounded = Math.round(diffFromCurrent * 10) / 10;
  if (rounded <= 0) return pill(t('analytics.diff.above', { diff: Math.abs(rounded).toFixed(1) }), 'good');
  return pill(t('analytics.diff.below', { diff: rounded.toFixed(1) }), 'warn');
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

function renderClassCard(cls, data, config, targets, onTargetChange) {
  const stats = classGradeStats(data, cls.id);
  const targetPct = targets[cls.id] ?? DEFAULT_TARGET_PCT;
  const projection = targetProjection(stats, targetPct);
  const msg = projectionMessage(stats, projection, targetPct);

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
      stats.currentPct != null ? pill(`${stats.currentPct.toFixed(0)}%`, pctClass(stats.currentPct)) : pill(t('analytics.noGradesYet'), 'dim'),
    ]),
    el('div', { class: 'analytics-card-section' }, [el('div', { class: 'field-label', text: t('analytics.trend') }), trendSection]),
    el('div', { class: 'analytics-card-section' }, [el('div', { class: 'field-label', text: t('analytics.category') }), categorySection]),
    el('div', { class: 'analytics-target-row' }, [
      el('label', { class: 'field-label', text: t('analytics.target') }),
      targetInput(cls.id, targetPct, onTargetChange),
      el('div', { class: 'analytics-status-line' }, [el('span', { class: `analytics-status text-${msg.cls}`, text: msg.text }), diffPill(projection.diffFromCurrent)]),
    ]),
  ]);
}

function renderComparisonCard(data, config) {
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

  return el('div', { class: 'analytics-card' }, [el('div', { class: 'field-label', text: t('analytics.comparison') }), body]);
}

export function renderAnalyticsTab(data, config, targets, onTargetChange) {
  if (data.classes.length === 0) {
    return el('div', { class: 'empty-state' }, [el('div', { class: 'empty-icon', text: '·' }), el('p', { text: t('analytics.noClasses') })]);
  }
  return el('div', { class: 'analytics-tab' }, [
    renderComparisonCard(data, config),
    el(
      'div',
      { class: 'analytics-grid' },
      data.classes.map((cls) => renderClassCard(cls, data, config, targets, onTargetChange)),
    ),
  ]);
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
