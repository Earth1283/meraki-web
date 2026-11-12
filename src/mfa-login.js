// The code step of signing in, for an account with an authenticator: shown in
// place of the password form once the password has been accepted.
import { el } from './dom.js';
import { t } from './i18n.js';
import { APP_URL } from './api.js';
import * as mfa from './mfa.js';

function failureText(err) {
  if (err instanceof mfa.WrongCodeError) return t('mfa.wrongCode');
  if (err instanceof mfa.TooManyAttemptsError) return t('mfa.tooMany');
  return t('login.unreachable');
}

/** `pending` is what api.login handed back; `onDone` runs once signed in and
 * `onCancel` returns to the password form. */
export function buildMfaStep(pending, { onDone, onCancel }) {
  let busy = false;
  const root = el('div', { class: 'mfa-step' });

  async function submit(code) {
    if (busy || !code.trim()) return;
    busy = true;
    draw();
    try {
      await mfa.verifyLoginCode(pending, code);
      onDone();
    } catch (err) {
      busy = false;
      draw({ error: failureText(err) });
    }
  }

  function draw({ error = '' } = {}) {
    const input = el('input', {
      id: 'mfa-code', class: 'mfa-code', type: 'text', name: 'code', inputmode: 'numeric',
      autocomplete: 'one-time-code', spellcheck: 'false', maxlength: 6, placeholder: '000000', disabled: busy,
    });
    input.addEventListener('input', () => { if (input.value.length === 6) submit(input.value); });
    root.replaceChildren(el('form', {
      class: 'mfa-form',
      onsubmit: (e) => { e.preventDefault(); submit(input.value); },
    }, [
      el('h2', { class: 'mfa-title', text: t('mfa.title') }),
      el('p', { class: 'mfa-prompt', text: t('mfa.login.prompt') }),
      el('label', { class: 'field-label', for: 'mfa-code', text: t('mfa.code') }),
      input,
      el('p', { class: 'form-error', role: 'alert', hidden: !error, text: error }),
      el('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: busy, text: busy ? t('mfa.verifying') : t('mfa.verify') }),
      el('p', { class: 'mfa-lost' }, [
        `${t('mfa.lost')} `,
        el('a', { href: `${APP_URL}/auth`, target: '_blank', rel: 'noopener', text: t('mfa.lostLink') }),
      ]),
      el('div', { class: 'mfa-links' }, [el('button', { type: 'button', class: 'mfa-link', disabled: busy, onclick: onCancel, text: t('mfa.cancel') })]),
    ]));
    if (!busy) input.focus();
  }

  draw();
  return root;
}
