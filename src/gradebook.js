// A class's grade the way the official site works it out (its gradebook and
// class pages share one calculation):
// - a mark can stand in for a score: excused marks drop the assignment,
//   "counts as zero" marks score it 0, and "% credit" marks score that share
//   of its points;
// - work in the "Extra credit" category adds points without adding to what's
//   possible;
// - a class set up as weighted averages its categories by weight, and work
//   outside the setup's categories shares whatever weight they leave over.
// The setup lives in classes.weights; anything it leaves out falls back to
// the official defaults.
import { DEFAULT_MARKS, findMark } from './marks.js';

export const EXTRA_CREDIT = 'Extra credit';

export const DEFAULT_CATEGORIES = [
  { name: 'Homework', weight: 20 },
  { name: 'Quiz', weight: 20 },
  { name: 'Test', weight: 40 },
  { name: 'Project', weight: 15 },
  { name: 'Participation', weight: 5 },
];

const ALL = Symbol('all work');

/** A class's grading setup ({ mode, categories, marks }) from its `weights`. */
export function gradeSetup(weights) {
  const w = weights && typeof weights === 'object' ? weights : {};
  const categories = Array.isArray(w.categories) ? w.categories.filter((c) => c && typeof c.name === 'string') : [];
  return {
    mode: w.mode === 'weighted' ? 'weighted' : 'unweighted',
    categories: categories.length ? categories : DEFAULT_CATEGORIES,
    marks: Array.isArray(w.marks) ? w.marks : DEFAULT_MARKS,
  };
}

export function isExtraCredit(category) {
  return (category ?? '').trim().toLowerCase() === EXTRA_CREDIT.toLowerCase();
}

/** The points an entry ({ pointsEarned, pointsPossible, markCode }) counts
 * for once its mark is applied, or null when it doesn't count: ungraded, or
 * excused. A mark the setup doesn't define leaves the score as it is. */
export function countedPoints({ pointsEarned, pointsPossible, markCode }, marks) {
  const mark = findMark(markCode, marks);
  if (mark?.behavior === 'exclude') return null;
  if (mark?.behavior === 'zero') return 0;
  if (mark?.behavior === 'value') return (Number(mark.value ?? 0) / 100) * Number(pointsPossible);
  return pointsEarned;
}

/** The class percentage from `entries` ({ category, pointsPossible,
 * pointsEarned, markCode }, ungraded ones included or not), or null when
 * nothing counts yet. */
export function classPercent(entries, setup) {
  const groups = new Map();
  let bonusEarned = 0;
  let bonusPossible = 0;
  for (const entry of entries) {
    const earned = countedPoints(entry, setup.marks);
    if (earned == null) continue;
    const possible = Number(entry.pointsPossible);
    if (isExtraCredit(entry.category)) {
      bonusEarned += Number(earned);
      bonusPossible += possible;
      continue;
    }
    const key = setup.mode === 'weighted' ? entry.category : ALL;
    const group = groups.get(key) ?? { earned: 0, possible: 0 };
    group.earned += Number(earned);
    group.possible += possible;
    groups.set(key, group);
  }
  // Nothing but extra credit reads as full marks, as long as some was earned.
  const onlyBonus = bonusEarned && bonusPossible ? 100 : null;

  if (setup.mode !== 'weighted') {
    const all = groups.get(ALL);
    return all?.possible ? ((all.earned + bonusEarned) / all.possible) * 100 : onlyBonus;
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const category of setup.categories) {
    const group = groups.get(category.name);
    if (!group?.possible) continue;
    weighted += (group.earned / group.possible) * 100 * Number(category.weight || 0);
    totalWeight += Number(category.weight || 0);
  }
  const others = [...groups.entries()].filter(([name]) => !setup.categories.some((c) => c.name === name)).map(([, group]) => group);
  const otherPossible = others.reduce((sum, group) => sum + group.possible, 0);
  if (otherPossible) {
    const leftover = Math.max(0, 100 - totalWeight) || 0;
    if (leftover > 0) {
      weighted += (others.reduce((sum, group) => sum + group.earned, 0) / otherPossible) * 100 * leftover;
      totalWeight += leftover;
    }
  }
  if (!totalWeight) return onlyBonus;
  // Extra credit on top, as a share of everything else that's possible.
  const allPossible = [...groups.values()].reduce((sum, group) => sum + group.possible, 0);
  const bonusOnItsOwn = bonusPossible ? (bonusEarned / bonusPossible) * 100 : 0;
  return weighted / totalWeight + (allPossible ? (bonusEarned / allPossible) * 100 : bonusOnItsOwn);
}

/** The official dashboard's "Overall grade": every scored grade's points
 * over its assignment's points, across all classes. The dashboard doesn't
 * apply marks or class setups, so neither does this. Null with nothing
 * possible to score. */
export function overallPointsPct(grades) {
  const scored = grades.filter((g) => g.points_earned != null && g.assignments);
  const possible = scored.reduce((sum, g) => sum + Number(g.assignments.points_possible ?? 0), 0);
  return possible ? (scored.reduce((sum, g) => sum + Number(g.points_earned), 0) / possible) * 100 : null;
}
