// Marks: codes a teacher can score work with instead of points ("M" for
// missing, "EX" for excused…). A grade scored with one keeps "MARK:<code>" in
// its comment, the same pattern the official site reads it back with.
const MARK_COMMENT = /^MARK:([A-Za-z0-9+-]{1,6})/;

// What a class uses until its teacher sets up marks of their own; the
// official site's defaults.
export const DEFAULT_MARKS = [
  { code: 'M', label: 'Missing', behavior: 'zero' },
  { code: 'EX', label: 'Exempt / excused', behavior: 'exclude' },
  { code: 'INC', label: 'Incomplete', behavior: 'exclude' },
  { code: 'L', label: 'Late (half credit)', behavior: 'value', value: 50 },
];

/** The mark code a grade comment holds, uppercased, or null. */
export function markCode(comment) {
  const match = MARK_COMMENT.exec((comment ?? '').trim());
  return match ? match[1].toUpperCase() : null;
}

/** The definition of mark `code` among `marks` ({ code, label, behavior:
 * 'exclude' | 'zero' | 'value', value }, see gradebook.gradeSetup), or null. */
export function findMark(code, marks) {
  if (!code) return null;
  return marks.find((m) => String(m?.code ?? '').toUpperCase() === code.toUpperCase()) ?? null;
}
