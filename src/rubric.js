// A graded assignment's rubric: each criterion, the level the teacher chose
// for it and what that earned. Meraki stores the rubric as criteria with
// levels ({ label, points, maxPoints, descriptor }) and the score as
// `selections`, the points picked per criterion id, which the criterion's
// weight then multiplies.
import { el } from './dom.js';
import { pill, pctClass } from './rows.js';
import { t } from './i18n.js';

const round2 = (n) => Math.round(n * 100) / 100;

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLevel(level) {
  const points = Math.max(0, number(level?.points));
  const maxPoints = Math.max(points, number(level?.maxPoints, points));
  return { label: String(level?.label ?? '') || t('rubric.level'), points, maxPoints, descriptor: String(level?.descriptor ?? '') };
}

function normalizeCriterion(criterion, index) {
  const weight = number(criterion?.weight, 1);
  return {
    id: String(criterion?.id ?? index),
    title: String(criterion?.title ?? ''),
    description: String(criterion?.description ?? ''),
    weight: weight > 0 ? weight : 1,
    levels: Array.isArray(criterion?.levels) ? criterion.levels.map(normalizeLevel) : [],
  };
}

/** The rubric's rows paired with a score's selections, or null when there's
 * nothing scored to show. A row's `level` is the first level whose point
 * range holds what was picked (null when none does), `earned` and `possible`
 * are weighted, and `total` is the teacher's own sum where they recorded one. */
export function rubricBreakdown(rubric, score) {
  if (!rubric || !score) return null;
  const selections = score.selections && typeof score.selections === 'object' && !Array.isArray(score.selections) ? score.selections : {};
  const rows = (Array.isArray(rubric.criteria) ? rubric.criteria : []).map(normalizeCriterion).map((criterion) => {
    const picked = Number(selections[criterion.id]);
    const scored = Number.isFinite(picked);
    const level = scored ? criterion.levels.find((l) => picked >= l.points && picked <= l.maxPoints) ?? null : null;
    const top = criterion.levels.reduce((max, l) => Math.max(max, l.maxPoints), 0);
    return {
      id: criterion.id,
      title: criterion.title,
      description: criterion.description,
      weight: criterion.weight,
      scored,
      level,
      earned: scored ? round2(picked * criterion.weight) : null,
      possible: round2(top * criterion.weight),
    };
  });
  if (rows.length === 0) return null;
  const earned = round2(rows.reduce((sum, r) => sum + (r.earned ?? 0), 0));
  const possible = number(rubric.total_points) || round2(rows.reduce((sum, r) => sum + r.possible, 0));
  return { title: rubric.title || '', rows, earned: score.points_earned != null ? number(score.points_earned, earned) : earned, possible, comment: score.comment || null };
}

function criterionRow(row) {
  const pct = row.scored && row.possible > 0 ? (row.earned / row.possible) * 100 : null;
  return el('li', { class: 'rubric-row' }, [
    el('div', { class: 'rubric-row-head' }, [
      el('span', { class: 'rubric-criterion', text: row.title }),
      row.weight !== 1 ? el('span', { class: 'rubric-weight', text: t('rubric.weight', { n: row.weight }) }) : null,
      el('span', { class: 'rubric-points', text: row.scored ? `${row.earned}/${row.possible}` : t('rubric.notScored') }),
    ]),
    row.level ? el('div', { class: 'rubric-level' }, [pill(row.level.label, pctClass(pct)), row.level.descriptor ? el('span', { class: 'rubric-descriptor', text: row.level.descriptor }) : null]) : null,
  ]);
}

/** The "Rubric" section of an assignment's detail. `loaded` arrives the way
 * lazyFetch hands it over: undefined while loading, { error } if the fetch
 * failed, otherwise { rubric, score }. Renders nothing when there's no
 * score to break down. */
export function renderRubricBreakdown(loaded) {
  const section = el('div', { class: 'detail-section' }, [el('div', { class: 'row-section' }, t('rubric.title'))]);
  if (!loaded) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.loading') }));
    return section;
  }
  if (loaded.error) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('rubric.failed', { msg: loaded.error }) }));
    return section;
  }
  const breakdown = rubricBreakdown(loaded.rubric, loaded.score);
  if (!breakdown) return null;
  section.appendChild(el('ul', { class: 'rubric-list' }, breakdown.rows.map(criterionRow)));
  section.appendChild(
    el('div', { class: 'rubric-total' }, [el('span', { text: t('rubric.total') }), el('span', { class: 'rubric-points', text: `${breakdown.earned}/${breakdown.possible}` })]),
  );
  if (breakdown.comment) {
    section.appendChild(el('figure', { class: 'feedback-note' }, [el('figcaption', { class: 'feedback-label', text: t('rubric.comment') }), el('blockquote', { class: 'feedback-text', text: breakdown.comment })]));
  }
  return section;
}
