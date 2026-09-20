// A class's detail panel: its assignments/assessments/discussions/files and
// roster, grouped into sub-sections.
import { el } from './dom.js';
import { state, openSubDetail } from './state.js';
import { openContextMenu, menuItemsFor } from './contextmenu.js';
import { classSections, renderItemBody } from './rows.js';
import { t } from './i18n.js';

function classSubSection(label, indices, kind, emptyText) {
  const items = indices.map((index) => {
    const target = { kind, index };
    return el(
      'button',
      {
        class: 'row-item compact',
        type: 'button',
        onclick: () => openSubDetail(target),
        oncontextmenu: (e) => {
          e.preventDefault();
          openContextMenu(e.clientX, e.clientY, menuItemsFor(target));
        },
      },
      [renderItemBody(target, state.data, state.ownUserId)],
    );
  });
  return el('div', { class: 'detail-section' }, [
    el('div', { class: 'row-section' }, label),
    items.length ? el('div', { class: 'row-list' }, items) : el('div', { class: 'row-placeholder', text: emptyText }),
  ]);
}

export function buildClassSections(classIndex) {
  const c = state.data.classes[classIndex];
  const s = classSections(state.data, c.id);
  const roster = s.roster.map((i) => state.data.enrollments[i]);

  return el('div', { class: 'class-sections' }, [
    classSubSection(t('class.assignments'), s.assignments, 'assignment', t('class.noAssignments')),
    classSubSection(t('class.assessments'), s.assessments, 'assessment', t('class.noAssessments')),
    classSubSection(t('class.discussions'), s.discussions, 'discussion', t('class.noDiscussions')),
    classSubSection(t('class.files'), s.files, 'fileUpload', t('class.noFiles')),
    el('div', { class: 'detail-section' }, [
      el('div', { class: 'row-section' }, t('class.roster')),
      roster.length
        ? el(
            'div',
            { class: 'roster-list' },
            roster.map((e) =>
              el('div', { class: 'roster-row' }, [
                el('span', { class: 'roster-name', text: `${e.students?.first_name ?? ''} ${e.students?.last_name ?? ''}`.trim() || t('field.noData') }),
                el('span', { class: 'roster-meta', text: e.students?.grade_level != null ? t('class.gradeLevel', { n: e.students.grade_level }) : '' }),
              ]),
            ),
          )
        : el('div', { class: 'row-placeholder', text: t('class.noRoster') }),
    ]),
  ]);
}
