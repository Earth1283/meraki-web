// Standards mastery: how a student is doing against each Common Core
// standard, from the tables Meraki tags assignments with (assignmentStandards
// is the standard_id <-> assignment_id join, carrying the assignment's own
// title/class_id for convenience). Grading follows classGradeStats exactly
// (see gradebook.js) — marks, excused grades and extra credit all behave the
// same way here as they do on a class grade, just summed across whatever
// assignments happen to carry the standard instead of one class's roster.
import { gradeSetup, countedPoints, isExtraCredit } from './gradebook.js';
import { markCode } from './marks.js';

function classIdFor(link, data) {
  return link.assignments?.class_id ?? data.assignments.find((a) => a.id === link.assignment_id)?.class_id ?? null;
}

function gradeFor(data, assignmentId) {
  return data.grades.find((g) => g.assignment_id === assignmentId && (g.points_earned != null || markCode(g.comment))) ?? null;
}

export function hasStandardsData(data) {
  return (data.standards?.length ?? 0) > 0;
}

/** Per standard: its tagged assignments (deduped, optionally scoped to
 * `classId`), how many are graded, points earned vs possible, a percentage,
 * and a status telling the untagged/ungraded/graded cases apart so a caller
 * never has to guess why `pct` is null. */
export function standardsMastery(data, { classId = null } = {}) {
  const standards = data.standards ?? [];
  const links = data.assignmentStandards ?? [];
  const setupCache = new Map();
  const setupFor = (clsId) => {
    if (!setupCache.has(clsId)) setupCache.set(clsId, gradeSetup(data.classes.find((c) => c.id === clsId)?.weights));
    return setupCache.get(clsId);
  };

  return standards.map((standard) => {
    const scoped = links.filter((link) => link.standard_id === standard.id && (classId == null || classIdFor(link, data) === classId));

    const seen = new Set();
    const assignmentIds = [];
    for (const link of scoped) {
      if (link.assignment_id == null || seen.has(link.assignment_id)) continue;
      seen.add(link.assignment_id);
      assignmentIds.push(link.assignment_id);
    }

    let earnedPoints = 0;
    let possiblePoints = 0;
    let bonusEarned = 0;
    let bonusPossible = 0;
    let gradedCount = 0;

    for (const assignmentId of assignmentIds) {
      const assignment = data.assignments.find((a) => a.id === assignmentId);
      if (!assignment || assignment.points_possible == null) continue;
      const g = gradeFor(data, assignmentId);
      if (!g) continue;
      const entry = { pointsPossible: Number(assignment.points_possible), pointsEarned: g.points_earned == null ? null : Number(g.points_earned), markCode: markCode(g.comment) };
      const earned = countedPoints(entry, setupFor(assignment.class_id).marks);
      if (earned == null) continue; // excused: counts for nothing, now or later
      gradedCount += 1;
      if (isExtraCredit(assignment.category)) {
        bonusEarned += earned;
        bonusPossible += entry.pointsPossible;
      } else {
        earnedPoints += earned;
        possiblePoints += entry.pointsPossible;
      }
    }

    // Nothing but extra credit reads as full marks, as long as some was
    // earned — same rule classGradeStats.classPercent applies.
    const onlyBonus = bonusEarned && bonusPossible ? 100 : null;
    const pct = possiblePoints > 0 ? ((earnedPoints + bonusEarned) / possiblePoints) * 100 : onlyBonus;
    const taggedCount = assignmentIds.length;

    return {
      id: standard.id,
      code: standard.code,
      description: standard.description,
      subject: standard.subject,
      gradeLevel: standard.grade_level,
      taggedCount,
      gradedCount,
      earnedPoints: earnedPoints + bonusEarned,
      possiblePoints,
      pct,
      status: taggedCount === 0 ? 'untagged' : pct == null ? 'ungraded' : 'graded',
    };
  });
}

/** Standards with a real percentage, weakest first — the actionable
 * ordering. Untagged/ungraded standards carry no percentage to rank by, so
 * they're left out; ties break by code for a stable order. */
export function weakestStandardsFirst(mastery) {
  return mastery
    .filter((m) => m.status === 'graded')
    .slice()
    .sort((a, b) => a.pct - b.pct || a.code.localeCompare(b.code));
}
