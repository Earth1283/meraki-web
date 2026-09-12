import { el, svgIcon, clear } from './dom.js';
import { t } from './i18n.js';
import { pctClass, pill, emptyState, gradeCircle } from './rows.js';
import { seededRandom, sketchArrow, sketchSvg } from './sketch.js';
import { iconPaths } from './icons.js';
import { letterGrade, overallGrade } from './grading.js';

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

/** A class's assignments with no grade yet: the ones a What if score can
 * stand in for. */
export function whatIfCandidates(data, classId) {
  return data.assignments.filter(
    (a) => a.class_id === classId && a.points_possible != null && !data.grades.some((g) => g.assignment_id === a.id && g.points_earned != null),
  );
}

/** `data` as if every What if score were a real grade: scores fill in
 * ungraded assignments (a real grade always wins), and a class's `extra`
 * adds one more graded assignment. Feed the result to classGradeStats or
 * overallGrade to see where things would land. */
export function applyWhatIf(data, whatIf = {}) {
  const assignments = [...data.assignments];
  const grades = [...data.grades];
  for (const [classId, entry] of Object.entries(whatIf)) {
    for (const [assignmentId, points] of Object.entries(entry?.scores ?? {})) {
      if (Number.isFinite(points)) grades.push({ id: `what-if:${assignmentId}`, assignment_id: assignmentId, points_earned: points, updated_at: null });
    }
    const extra = entry?.extra;
    if (Number.isFinite(extra?.earned) && Number.isFinite(extra?.possible) && extra.possible > 0) {
      const id = `what-if-extra:${classId}`;
      assignments.push({ id, class_id: classId, title: null, category: null, points_possible: extra.possible });
      grades.push({ id, assignment_id: id, points_earned: extra.earned, updated_at: null });
    }
  }
  return { ...data, assignments, grades };
}

function hasWhatIfScores(entry) {
  return Object.values(entry?.scores ?? {}).some(Number.isFinite) || (Number.isFinite(entry?.extra?.earned) && entry.extra.possible > 0);
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

function whatIfInput(value, onInput, attrs = {}) {
  return el('input', {
    class: 'field-input whatif-input',
    type: 'number',
    min: '0',
    step: 'any',
    inputmode: 'decimal',
    value: Number.isFinite(value) ? String(value) : undefined,
    oninput: (e) => {
      const n = e.target.value === '' ? null : Number(e.target.value);
      onInput(Number.isFinite(n) ? n : null);
    },
    ...attrs,
  });
}

function gradeLabel(pct, scale) {
  if (pct == null) return '—';
  return `${pct.toFixed(1)}% (${letterGrade(pct, scale).letter})`;
}

// What if: type a score for any ungraded assignment (or add one more
// assignment) and watch the class grade move. The inputs write through
// whatIf.set, which doesn't re-render; instead every result line on the tab
// is patched in place through the shared `updaters` (the GPA line depends on
// every class's what-ifs, not just the one being edited).
function renderWhatIf(cls, data, config, whatIf, updaters) {
  const scale = config.gradingScale;
  const entryNow = () => whatIf.get()[cls.id] ?? {};
  const update = (patch) => {
    const entry = entryNow();
    whatIf.set(cls.id, { ...entry, ...patch(entry) });
    updaters.forEach((fn) => fn());
  };

  const result = el('div', { class: 'whatif-result', 'aria-live': 'polite' });
  updaters.push(() => {
    clear(result);
    const entry = entryNow();
    if (!hasWhatIfScores(entry)) {
      result.append(el('span', { class: 'analytics-empty-note', text: t('analytics.whatIfEmpty') }));
      return;
    }
    const before = classGradeStats(data, cls.id).currentPct;
    const after = classGradeStats(applyWhatIf(data, { [cls.id]: entry }), cls.id).currentPct;
    result.append(
      el('span', { class: 'whatif-from', text: gradeLabel(before, scale) }),
      el('span', { class: 'whatif-arrow', 'aria-hidden': 'true', text: '→' }),
      el('span', { class: `whatif-to text-${pctClass(after)}`, text: gradeLabel(after, scale) }),
    );
  });

  const rows = whatIfCandidates(data, cls.id).map((a) =>
    el('label', { class: 'whatif-row' }, [
      el('span', { class: 'whatif-row-label', text: a.title, title: a.title }),
      whatIfInput(entryNow().scores?.[a.id], (points) => update((e) => ({ scores: { ...e.scores, [a.id]: points } })), { 'aria-label': a.title }),
      el('span', { class: 'whatif-of', text: `/ ${a.points_possible}` }),
    ]),
  );
  rows.push(
    el('div', { class: 'whatif-row' }, [
      el('span', { class: 'whatif-row-label', text: t('analytics.whatIfExtra') }),
      whatIfInput(entryNow().extra?.earned, (earned) => update((e) => ({ extra: { ...e.extra, earned } })), { 'aria-label': t('analytics.whatIfEarned') }),
      el('span', { class: 'whatif-of', text: '/' }),
      whatIfInput(entryNow().extra?.possible, (possible) => update((e) => ({ extra: { ...e.extra, possible } })), { 'aria-label': t('analytics.whatIfPossible') }),
    ]),
  );

  const entry = entryNow();
  const details = el('details', { class: 'whatif', open: entry.open || hasWhatIfScores(entry) || undefined }, [
    el('summary', { class: 'field-label', text: t('analytics.whatIf') }),
    el('div', { class: 'whatif-list' }, rows),
    el('div', { class: 'whatif-footer' }, [
      result,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => whatIf.clear(cls.id), text: t('analytics.whatIfClear') }),
    ]),
  ]);
  details.addEventListener('toggle', () => whatIf.set(cls.id, { ...entryNow(), open: details.open }));
  return details;
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
  let gpaLine = null;
  if (whatIf) {
    gpaLine = el('div', { class: 'whatif-gpa', 'aria-live': 'polite' });
    updaters.push(() => {
      clear(gpaLine);
      const all = whatIf.get();
      const before = overallGrade(data, config.gradingScale);
      const after = Object.values(all).some(hasWhatIfScores) ? overallGrade(applyWhatIf(data, all), config.gradingScale) : null;
      gpaLine.hidden = before?.gpa == null || after?.gpa == null;
      if (!gpaLine.hidden) gpaLine.append(t('analytics.whatIfGpa', { from: before.gpa.toFixed(2), to: after.gpa.toFixed(2) }));
    });
  }

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
