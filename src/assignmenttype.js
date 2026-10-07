const KNOWN = new Map([
  ['homework', 0],
  ['quiz', 1],
  ['major', 2],
  ['test', 2],
  ['exam', 2],
  ['project', 3],
  ['behavior', 4],
  ['classwork', 5],
  ['participation', 5],
]);

export const TYPE_TONES = 6;

/** Which of the TYPE_TONES colors an assignment's category wears: fixed for
 * the names classes usually use, a stable hash of the name for any other, so
 * a category keeps its color from one render and one device to the next. */
export function categoryTone(category) {
  const key = String(category ?? '').trim().toLowerCase();
  if (!key) return null;
  if (KNOWN.has(key)) return KNOWN.get(key);
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % TYPE_TONES;
}
