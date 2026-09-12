// Letter grades and an unweighted GPA estimate for Overview's "Overall grade"
// tile, on one of two scales (config.gradingScale):
// - 'standard': the school profile's table, reproduced as-is, gaps included
//   (no C+/C-/D+/D-, a seven-point B-).
// - 'legacy': the tens digit picks the letter and the ones digit the sign
//   (7-9 plus, 3-6 plain, 0-2 minus, the common US split); below 60 is an F.
// Percentages round to the nearest whole point before lookup (91.6 → 92) and
// clamp to 0-100, so extra credit past 100 still reads as the top grade.
// The GPA is unweighted: every class counts once at its standard-course
// points. Course levels (honors, AP) aren't in the data yet.
import { classGradeStats } from './analytics.js';
import { overallPointsPct } from './gradebook.js';

export const GRADING_SCALES = ['standard', 'legacy'];

// [lowest rounded %, letter, grade points], highest first.
const STANDARD = [
  [97, 'A+', 4.0],
  [92, 'A', 4.0],
  [87, 'A-', 3.7],
  [82, 'B+', 3.3],
  [77, 'B', 3.0],
  [70, 'B-', 2.7],
  [65, 'C', 2.2],
  [60, 'D', 1.7],
  [0, 'F', 0],
];

// Legacy has no published grade points, so it uses the usual unweighted 4.0
// values (A+ capped at 4.0, as on the standard table).
const LEGACY_POINTS = { 'A+': 4.0, A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7, 'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, 'D-': 0.7, F: 0 };

/** { letter, points } for a percentage on `scale`, or null with no percentage.
 * Unknown scales fall back to standard. */
export function letterGrade(pct, scale = 'standard') {
  if (pct == null || !Number.isFinite(pct)) return null;
  const p = Math.min(100, Math.max(0, Math.round(pct)));
  if (scale === 'legacy') {
    if (p < 60) return { letter: 'F', points: 0 };
    const tens = Math.min(9, Math.floor(p / 10));
    const ones = p === 100 ? 9 : p % 10;
    const letter = 'DCBA'[tens - 6] + (ones >= 7 ? '+' : ones >= 3 ? '' : '-');
    return { letter, points: LEGACY_POINTS[letter] };
  }
  const [, letter, points] = STANDARD.find(([min]) => p >= min);
  return { letter, points };
}

/** The Overall grade tile's numbers. The percentage is the official
 * dashboard's (every scored grade's points over its assignment's points,
 * see gradebook.overallPointsPct), lettered on `scale`. The GPA averages the
 * grade points of each class's own grade, the one Analytics shows, so it's
 * null when no class can be graded (e.g. grades whose assignments aren't
 * loaded). Returns null when nothing is scored at all. */
export function overallGrade(data, scale = 'standard') {
  const s = GRADING_SCALES.includes(scale) ? scale : 'standard';
  const pct = overallPointsPct(data.grades);
  if (pct == null) return null;
  const classPcts = data.classes.map((c) => classGradeStats(data, c.id).currentPct).filter((p) => p != null);
  const gpa = classPcts.length ? classPcts.reduce((sum, p) => sum + letterGrade(p, s).points, 0) / classPcts.length : null;
  return { pct, gpa, classCount: classPcts.length, scale: s, ...letterGrade(pct, s) };
}
