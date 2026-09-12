// Adding work to your portfolio, and removing what you added.
import { el } from './dom.js';
import { state, closeOverlay, nextTempId, optimisticInsert, optimisticDelete } from './state.js';
import { showToast } from './toast.js';
import { sidePanel } from './panels.js';
import { t } from './i18n.js';

// Student-added portfolio work is kind 'artifact', same as on the official
// site ('evidence' is what staff add).
function addPortfolioItem({ title, description, link }) {
  const row = { id: nextTempId(), title, description, link, kind: 'artifact', created_at: new Date().toISOString() };
  return optimisticInsert('portfolio', row, 'portfolio_items', {
    student_id: state.ownStudentId,
    title,
    description,
    link,
    kind: 'artifact',
    added_by: state.ownUserId,
  });
}

/** Removes a portfolio item straight away (the official site doesn't ask
 * either), with Undo on the toast. Undo adds the same title, link and
 * description back as a new item: the original row is already gone. */
export function deletePortfolioItem(item) {
  if (String(item.id).startsWith('temp-')) return;
  const { title, description, link } = item;
  let failed = false;
  showToast(t('portfolio.deleted'), 'ok', {
    label: t('action.undo'),
    onClick: () => {
      if (failed) return;
      addPortfolioItem({ title, description, link }).catch((err) => showToast(t('portfolio.addFailed', { msg: err.message }), 'bad'));
    },
  });
  optimisticDelete('portfolio', item.id, 'portfolio_items').catch((err) => {
    failed = true;
    showToast(/removed nothing/.test(err.message) ? t('portfolio.deleteNotAllowed') : t('portfolio.deleteFailed', { msg: err.message }), 'bad');
  });
}

/** A portfolio item's detail panel actions: Remove, unless it's still saving. */
export function portfolioActions(item) {
  if (!item || String(item.id).startsWith('temp-')) return null;
  const removeBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: t('portfolio.delete') });
  removeBtn.addEventListener('click', () => {
    closeOverlay();
    deletePortfolioItem(item);
  });
  return el('div', { class: 'panel-actions' }, [removeBtn]);
}

export function buildPortfolioForm() {
  const title = el('input', { class: 'field-input', type: 'text', required: true, maxlength: 200, placeholder: t('portfolio.titlePlaceholder') });
  const link = el('input', { class: 'field-input', type: 'text', inputmode: 'url', maxlength: 500, placeholder: t('portfolio.linkPlaceholder') });
  const description = el('textarea', { class: 'field-input textarea', rows: 4, placeholder: t('portfolio.descriptionPlaceholder') });
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const showError = (text) => {
    errorLine.textContent = text;
    errorLine.hidden = false;
  };

  const form = el(
    'form',
    {
      class: 'panel-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (!state.ownStudentId) {
          showError(t('portfolio.noStudentRecord'));
          return;
        }
        const titleVal = title.value.trim();
        // The same minimum the official site enforces.
        if (titleVal.length < 2) {
          showError(t('portfolio.titleTooShort'));
          return;
        }

        closeOverlay();
        showToast(t('portfolio.added'));
        addPortfolioItem({ title: titleVal, description: description.value.trim() || null, link: link.value.trim() || null }).catch(
          (err) => showToast(t('portfolio.addFailed', { msg: err.message }), 'bad'),
        );
      },
    },
    [
      el('label', { class: 'field-label', text: t('portfolio.title') }),
      title,
      el('label', { class: 'field-label', text: t('label.link') }),
      link,
      el('label', { class: 'field-label', text: t('portfolio.description') }),
      description,
      errorLine,
      el('div', { class: 'panel-actions' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: closeOverlay, text: t('compose.cancel') }),
        el('button', { class: 'btn btn-primary', type: 'submit', text: t('portfolio.save') }),
      ]),
    ],
  );

  queueMicrotask(() => title.focus());
  return sidePanel(t('portfolio.addTitle'), form);
}
