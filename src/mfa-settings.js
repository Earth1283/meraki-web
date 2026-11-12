// Settings section for turning two-step verification on and off, and for the
// backup codes that go with it.
import { el } from './dom.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { getSession } from './api.js';
import { formatDateTime } from './rows.js';
import * as mfa from './mfa.js';

// Kept here, not in the built node, because the settings panel is rebuilt on
// every state change and that must not throw away a half-finished setup.
const fresh = (userId) => ({ userId, view: 'loading', factor: null, left: null, enrolment: null, codes: [], saved: false, busy: false, error: '', loading: false });
let ui = fresh(null);
let root = null;

async function load() {
  if (ui.loading) return;
  ui.loading = true;
  try {
    ui.factor = await mfa.getAuthenticator();
    ui.left = ui.factor ? await mfa.getBackupCodesLeft().catch(() => null) : null;
    ui.view = 'status';
  } catch {
    ui.view = 'failed';
  }
  ui.loading = false;
  draw();
}

function go(view, patch = {}) {
  Object.assign(ui, { view, error: '', busy: false }, patch);
  draw();
}

async function run(task, failure) {
  ui.busy = true;
  ui.error = '';
  draw();
  try {
    await task();
  } catch (err) {
    ui.busy = false;
    ui.error = typeof failure === 'function' ? failure(err) : failure;
    draw();
  }
}

const wrongOr = (fallback) => (err) => (err instanceof mfa.WrongCodeError ? t('mfa.wrongCode') : err instanceof mfa.TooManyAttemptsError ? t('mfa.tooMany') : fallback);

function startSetup() {
  return run(async () => {
    go('scan', { enrolment: await mfa.startEnrollment() });
  }, t('mfa.setupFailed'));
}

function newCodes() {
  return run(async () => {
    go('codes', { codes: await mfa.createBackupCodes(), saved: false, left: mfa.BACKUP_CODES_PER_SET });
  }, t('mfa.codesNeedReauth'));
}

function confirmSetup(code) {
  const { id } = ui.enrolment;
  return run(async () => {
    await mfa.confirmEnrollment(id, code);
    ui.factor = await mfa.getAuthenticator();
    try {
      go('codes', { codes: await mfa.createBackupCodes(), saved: false, enrolment: null, left: mfa.BACKUP_CODES_PER_SET });
    } catch {
      showToast(t('mfa.codesFailed'), 'bad');
      go('status', { enrolment: null });
    }
  }, wrongOr(t('mfa.setupFailed')));
}

function turnOff(code) {
  return run(async () => {
    await mfa.disableAuthenticator(ui.factor.id, code);
    showToast(t('mfa.disabled'), 'ok');
    go('status', { factor: null, left: null });
  }, wrongOr(t('mfa.disableFailed')));
}

function codeBox(onCode) {
  const input = el('input', {
    class: 'mfa-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6,
    placeholder: '000000', 'aria-label': t('mfa.code'), disabled: ui.busy,
  });
  input.addEventListener('input', () => { if (input.value.length === 6) onCode(input.value); });
  queueMicrotask(() => { if (!input.disabled) input.focus(); });
  return input;
}

const button = (text, onclick, kind = 'ghost', disabled = false) =>
  el('button', { type: 'button', class: `btn btn-${kind} btn-sm`, disabled: disabled || ui.busy, onclick, text });

function status() {
  const { factor, left } = ui;
  if (!factor) {
    return [
      el('p', { class: 'settings-hint', text: t('mfa.hint') }),
      el('div', { class: 'mfa-actions' }, [button(t('mfa.setUp'), startSetup, 'primary')]),
    ];
  }
  return [
    el('p', { class: 'settings-hint', text: [t('mfa.onSince', { date: formatDateTime(factor.createdAt) }), left === null ? '' : t('mfa.codesLeft', { n: left, total: mfa.BACKUP_CODES_PER_SET })].join(' ') }),
    el('div', { class: 'mfa-actions' }, [button(t('mfa.newCodes'), newCodes, 'ghost'), button(t('mfa.turnOff'), () => go('disable'))]),
  ];
}

function scan() {
  const { qrSvg, secret } = ui.enrolment;
  return [
    el('p', { class: 'settings-hint', text: t('mfa.scan.body') }),
    el('img', { class: 'mfa-qr', alt: t('mfa.qrAlt'), src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}` }),
    el('p', { class: 'settings-hint', text: t('mfa.secretHint') }),
    el('code', { class: 'mfa-secret', text: secret }),
    codeBox(confirmSetup),
    el('div', { class: 'mfa-actions' }, [button(t('mfa.cancelSetup'), () => go('status', { enrolment: null }))]),
  ];
}

function codes() {
  const text = ui.codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${t('mfa.codes.fileHeader')}\n\n${text}\n`], { type: 'text/plain' }));
    const a = el('a', { href: url, download: 'meraki-backup-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = () => navigator.clipboard?.writeText(text).then(() => showToast(t('mfa.copied'), 'ok'), () => {});
  const saved = el('input', { id: 'mfa-saved', type: 'checkbox', checked: ui.saved, onchange: (e) => { ui.saved = e.target.checked; draw(); } });
  return [
    el('p', { class: 'settings-hint', text: t('mfa.codes.body') }),
    el('ul', { class: 'mfa-codes' }, ui.codes.map((c) => el('li', { text: c }))),
    el('div', { class: 'mfa-actions' }, [button(t('mfa.copy'), copy), button(t('mfa.download'), download)]),
    el('label', { class: 'check-row', for: 'mfa-saved' }, [saved, el('span', { text: t('mfa.saved') })]),
    el('div', { class: 'mfa-actions' }, [button(t('mfa.done'), () => go('status', { codes: [] }), 'primary', !ui.saved)]),
  ];
}

function disable() {
  return [
    el('p', { class: 'settings-hint', text: t('mfa.disable.body') }),
    codeBox(turnOff),
    el('div', { class: 'mfa-actions' }, [button(t('mfa.cancelSetup'), () => go('status'))]),
  ];
}

const VIEWS = { status, scan, codes, disable };

function draw() {
  if (!root) return;
  if (ui.view === 'loading') return void root.replaceChildren(el('p', { class: 'settings-hint', text: t('mfa.loading') }));
  if (ui.view === 'failed') {
    return void root.replaceChildren(
      el('p', { class: 'form-error', text: t('mfa.loadFailed') }),
      el('div', { class: 'mfa-actions' }, [button(t('mfa.retry'), () => { ui.view = 'loading'; draw(); load(); })]),
    );
  }
  root.replaceChildren(
    ...VIEWS[ui.view](),
    el('p', { class: 'form-error', role: 'alert', hidden: !ui.error, text: ui.error }),
  );
}

export function buildMfaSettings() {
  const userId = getSession()?.user_id ?? null;
  if (ui.userId !== userId) ui = fresh(userId);
  root = el('div', { class: 'mfa-settings' });
  if (ui.view === 'loading') load();
  draw();
  return root;
}
