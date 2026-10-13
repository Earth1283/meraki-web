import { el } from './dom.js';
import { t } from './i18n.js';
import { draftSyncPreferences, setDraftSyncPreferences } from './drafts.js';

// Shared by Settings and the writing panel. Changing policy never submits work.
export function buildDraftSyncControls(userId) {
  let prefs = draftSyncPreferences(userId);
  const mode = el('select', { class: 'field-input' }, ['local', 'manual', 'idle', 'interval'].map(value =>
    el('option', { value, selected: value === prefs.mode, text: t(`drafts.mode.${value}`) })));
  const timing = el('select', { class: 'field-input' });
  const timingLabel = el('span', { class: 'field-label' });
  const timingRow = el('label', { class: 'draft-timing' }, [timingLabel, timing]);
  const hint = el('p', { class: 'settings-hint draft-cloud-hint' });
  const updateTiming = () => {
    timingRow.hidden = !['idle', 'interval'].includes(prefs.mode);
    timingLabel.textContent = t(prefs.mode === 'idle' ? 'drafts.afterPause' : 'drafts.every');
    timing.replaceChildren(...(prefs.mode === 'idle' ? [5000, 15000, 30000] : [30000, 60000, 300000]).map(value =>
      el('option', { value, selected: value === (prefs.mode === 'idle' ? prefs.delayMs : prefs.intervalMs), text: t(value < 60000 ? 'drafts.seconds' : 'drafts.minutes', { n: value < 60000 ? value / 1000 : value / 60000 }) })));
    hint.textContent = t(prefs.mode === 'local' ? 'drafts.localHint' : 'drafts.cloudHint');
  };
  mode.addEventListener('change', () => {
    prefs = setDraftSyncPreferences(userId, { mode: mode.value });
    updateTiming();
  });
  timing.addEventListener('change', () => {
    prefs = setDraftSyncPreferences(userId, { [prefs.mode === 'idle' ? 'delayMs' : 'intervalMs']: Number(timing.value) });
  });
  updateTiming();
  return el('div', { class: 'draft-sync-controls' }, [
    el('label', { class: 'draft-mode' }, [el('span', { class: 'field-label', text: t('drafts.when') }), mode]),
    timingRow, hint,
  ]);
}

export function draftStatusText(draft) {
  if (draft.localFailed || draft.fileLocalFailed) return t('drafts.localFailed');
  if (draft.loadingFile) return t('drafts.loadingFile');
  if (draft.missingFile) return t('drafts.missingFile');
  if (draft.sync?.status.syncing) return t('drafts.syncing');
  if (draft.sync?.status.error) return t('drafts.syncFailed', { msg: draft.sync.status.error.message });
  if (draft.sync?.status.syncedAt && !draft.sync.status.dirty) return t('drafts.synced');
  return t(draft.recovered ? 'drafts.recovered' : 'drafts.savedLocal');
}

export function buildDraftNote(draft, { userId, cloud = false, quiz = false, onSync, onDiscard }) {
  const status = el('p', { class: 'draft-status', role: 'status', 'aria-live': 'polite', text: draftStatusText(draft) });
  const sync = cloud ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: t('drafts.syncNow'), onclick: onSync }) : null;
  const discard = onDiscard ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: t('drafts.useCloudCopy'), onclick: onDiscard }) : null;
  const hasError = draft.localFailed || draft.fileLocalFailed || draft.missingFile || draft.sync?.status.error;
  const note = el('div', { class: `draft-note${hasError ? ' draft-note-error' : ''}` }, [
    el('div', { class: 'draft-note-header' }, [
      el('span', { class: 'draft-note-title', text: t('drafts.title') }),
      el('div', { class: 'draft-note-actions' }, [discard, sync]),
    ]),
    status,
    cloud ? el('details', { class: 'draft-policy' }, [
      el('summary', { text: t('drafts.syncOptions') }), buildDraftSyncControls(userId),
    ]) : el('p', { class: 'settings-hint', text: t(quiz ? 'drafts.quizHint' : 'drafts.submittedHint') }),
  ]);
  draft.updateStatus = () => {
    if (!note.isConnected) return;
    status.textContent = draftStatusText(draft);
    note.classList.toggle('draft-note-error', !!(draft.localFailed || draft.fileLocalFailed || draft.missingFile || draft.sync?.status.error));
    if (sync) {
      sync.hidden = draftSyncPreferences(userId).mode === 'local';
      sync.disabled = draft.saving || draft.loadingFile || !!draft.missingFile || draft.sync.status.syncing || !draft.sync.status.dirty;
    }
    if (discard) {
      discard.hidden = !draft.recovered;
      discard.disabled = draft.saving || draft.sync?.status.syncing;
    }
  };
  // Also set initial state before the note is attached.
  if (sync) {
    sync.hidden = draftSyncPreferences(userId).mode === 'local';
    sync.disabled = draft.saving || draft.loadingFile || !!draft.missingFile || draft.sync.status.syncing || !draft.sync.status.dirty;
  }
  if (discard) { discard.hidden = !draft.recovered; discard.disabled = draft.saving || draft.sync?.status.syncing; }
  return note;
}
