// My Record: strike notes filled into carbon-copy behavior slips, for fun.
// Same data as the plain row (date, reason), dressed up as the paperwork.
import { el } from './dom.js';
import { t } from './i18n.js';

/** Which strike this behavior note is, counting from your first (1), or null
 * when it isn't a strike. Rows arrive newest first, so on a shared date the
 * later row is the older one. */
export function strikeNumber(data, index) {
  if (data.behaviorNotes[index]?.kind !== 'strike') return null;
  const order = data.behaviorNotes
    .map((note, i) => ({ note, i }))
    .filter(({ note }) => note.kind === 'strike')
    .sort((a, b) => (a.note.date ?? '').localeCompare(b.note.date ?? '') || b.i - a.i);
  return order.findIndex(({ i }) => i === index) + 1;
}

/** The slip for behavior note `b`, strike number `number`. */
export function strikeSlip(b, number) {
  const student = `${b.students?.first_name ?? ''} ${b.students?.last_name ?? ''}`.trim();
  const line = (label, value, cls = '') =>
    el('div', { class: `slip-line ${cls}` }, [
      el('span', { class: 'slip-line-label', text: label }),
      el('span', { class: 'slip-line-value', text: value || '—' }),
    ]);
  return el('div', { class: 'strike-slip' }, [
    el('div', { class: 'slip-head' }, [
      el('span', { class: 'slip-heading', text: t('slip.heading') }),
      el('span', { class: 'slip-no', text: t('slip.number', { n: String(number).padStart(3, '0') }) }),
    ]),
    line(t('slip.student'), student),
    line(t('slip.date'), b.date),
    line(t('slip.reason'), b.notes, 'slip-reason'),
    el('div', { class: 'slip-foot' }, [
      el('span', { class: 'slip-sign', text: t('slip.signature') }),
      el('span', { class: 'slip-copy', text: t('slip.copy') }),
    ]),
    el('span', { class: 'slip-stamp', 'aria-hidden': 'true', text: t('slip.stamp', { n: number }) }),
  ]);
}
