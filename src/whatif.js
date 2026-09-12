// The Analytics tab's What if calculator: type a score for any ungraded
// assignment (or add one more assignment) and watch the class grade, and the
// GPA, move.
import { el, clear } from './dom.js';
import { classGradeStats } from './analytics.js';
import { letterGrade, overallGrade } from './grading.js';
import { gradeSetup } from './gradebook.js';
import { markCode } from './marks.js';
import { pctClass } from './rows.js';
import { t } from './i18n.js';

/** A class's assignments with no grade yet (no score and no mark): the ones
 * a What if score can stand in for. */
export function whatIfCandidates(data, classId) {
  return data.assignments.filter(
    (a) => a.class_id === classId && a.points_possible != null && !data.grades.some((g) => g.assignment_id === a.id && (g.points_earned != null || markCode(g.comment))),
  );
}

/** The category another assignment goes in when none was picked. In a
 * weighted class, work outside the setup's categories only shares the weight
 * they leave over (often none), so it's the first real category there. */
export function defaultExtraCategory(data, classId) {
  const setup = gradeSetup(data.classes.find((c) => c.id === classId)?.weights);
  return setup.mode === 'weighted' ? setup.categories[0].name : null;
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
      assignments.push({ id, class_id: classId, title: null, category: extra.category ?? defaultExtraCategory(data, classId), points_possible: extra.possible });
      grades.push({ id, assignment_id: id, points_earned: extra.earned, updated_at: null });
    }
  }
  return { ...data, assignments, grades };
}

export function hasWhatIfScores(entry) {
  return Object.values(entry?.scores ?? {}).some(Number.isFinite) || (Number.isFinite(entry?.extra?.earned) && entry.extra.possible > 0);
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

/** A class card's What if panel. The inputs write through whatIf.set, which
 * doesn't re-render; instead every result line on the tab is patched in place
 * through the shared `updaters` (the GPA line depends on every class's
 * what-ifs, not just the one being edited). */
export function renderWhatIf(cls, data, config, whatIf, updaters) {
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
  // A weighted class needs to know which category another assignment is in.
  const setup = gradeSetup(cls.weights);
  const categoryPicker =
    setup.mode === 'weighted'
      ? el(
          'select',
          {
            class: 'field-input whatif-category',
            'aria-label': t('analytics.whatIfCategory'),
            onchange: (e) => update((entry) => ({ extra: { ...entry.extra, category: e.target.value } })),
          },
          setup.categories.map((c) => el('option', { value: c.name, selected: (entryNow().extra?.category ?? setup.categories[0].name) === c.name || undefined }, c.name)),
        )
      : null;
  rows.push(
    el('div', { class: 'whatif-row' }, [
      el('span', { class: 'whatif-row-label', text: t('analytics.whatIfExtra') }),
      categoryPicker,
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

/** The comparison card's line for the GPA every entered What if score adds
 * up to; hidden until there's one. */
export function renderWhatIfGpa(data, config, whatIf, updaters) {
  const line = el('div', { class: 'whatif-gpa', 'aria-live': 'polite' });
  updaters.push(() => {
    clear(line);
    const all = whatIf.get();
    const before = overallGrade(data, config.gradingScale);
    const after = Object.values(all).some(hasWhatIfScores) ? overallGrade(applyWhatIf(data, all), config.gradingScale) : null;
    line.hidden = before?.gpa == null || after?.gpa == null;
    if (!line.hidden) line.append(t('analytics.whatIfGpa', { from: before.gpa.toFixed(2), to: after.gpa.toFixed(2) }));
  });
  return line;
}
