// The pre-auth login screen, plus the language switcher it shares with the
// settings dialog (see settings.js) so the picker itself never needs a user
// to be logged in to be reachable.
import { el, mount, svgIcon } from './dom.js';
import * as api from './api.js';
import { iconPaths } from './icons.js';
import { t, LOCALES, getLocale, setLocale } from './i18n.js';

/** Shared language <select> — used on the (pre-auth) login screen and in
 * the toolbar once signed in, so the language picker itself never needs a
 * user to be logged in to be reachable. */
export function buildLanguageSwitcher(extraClass = '') {
  const select = el(
    'select',
    {
      class: `lang-switcher ${extraClass}`,
      'aria-label': t('toolbar.language'),
      title: t('toolbar.language'),
      onchange: (e) => setLocale(e.target.value),
    },
    LOCALES.map((l) => el('option', { value: l.code, selected: l.code === getLocale() || undefined }, l.label)),
  );
  return select;
}

/** Flicking the login page's data-privacy sticky note swings it from its
 * tape (.is-swinging in styles.css). Clicks mid-swing are ignored rather
 * than restarting it, which would snap the note back to rest first; so is
 * the click that ends a text selection, so the note doesn't jerk away from
 * someone copying it. */
function swingNote(note) {
  if (note.classList.contains('is-swinging') || String(window.getSelection())) return;
  note.classList.add('is-swinging');
}

function settleNote(e) {
  if (e.animationName === 'note-swing') e.currentTarget.classList.remove('is-swinging');
}

export function mountLogin(root, onLoggedIn) {
  const emailInput = el('input', { id: 'login-identity', type: 'text', name: 'email', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: t('login.emailPlaceholder') });
  const passwordInput = el('input', { id: 'login-password', type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const revealButton = el('button', {
    class: 'password-reveal',
    type: 'button',
    'aria-label': t('login.showPassword'),
    title: t('login.showPassword'),
    onclick: () => {
      const reveal = passwordInput.type === 'password';
      passwordInput.type = reveal ? 'text' : 'password';
      revealButton.setAttribute('aria-label', t(reveal ? 'login.hidePassword' : 'login.showPassword'));
      revealButton.setAttribute('title', t(reveal ? 'login.hidePassword' : 'login.showPassword'));
      revealButton.replaceChildren(svgIcon(iconPaths(reveal ? 'eyeOff' : 'eye')));
    },
  }, [svgIcon(iconPaths('eye'))]);
  const errorLine = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submitBtn = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: t('login.submit') });

  const form = el(
    'form',
    {
      class: 'login-form',
      onsubmit: async (e) => {
        e.preventDefault();
        errorLine.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = t('login.loggingIn');
        try {
          await api.login(emailInput.value.trim(), passwordInput.value);
          onLoggedIn();
        } catch (err) {
          errorLine.textContent = /login failed/i.test(err.message)
            ? t('login.wrongCreds')
            : t('login.unreachable');
          errorLine.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = t('login.submit');
        }
      },
    },
    [
      el('label', { class: 'field-label', for: 'login-identity', text: t('login.identity') }),
      emailInput,
      el('label', { class: 'field-label', for: 'login-password', text: t('login.password') }),
      el('div', { class: 'password-field' }, [passwordInput, revealButton]),
      errorLine,
      submitBtn,
      el('p', { class: 'login-help' }, [
        el('a', { href: api.APP_URL, target: '_blank', rel: 'noopener', text: t('login.signInHelp') }),
        document.createTextNode(` ${t('login.contactSchool')}`),
      ]),
    ],
  );

  mount(
    root,
    el('div', { class: 'login-screen' }, [
      buildLanguageSwitcher('login-lang-switcher'),
      el('div', { class: 'login-card' }, [
        el('h1', { class: 'brand', text: t('brand') }),
        el('p', { class: 'login-sub', text: t('login.subtitle') }),
        el('div', { class: 'login-trust', role: 'note' }, [
          el('p', { class: 'login-trust-title', text: t('login.privacyTitle') }),
          el('p', { class: 'login-trust-body', text: t('login.privacyBody') }),
        ]),
        form,
      ]),
      el(
        'div',
        { class: 'sticky-note', role: 'note', onclick: (e) => swingNote(e.currentTarget), onanimationend: settleNote },
        [
          el('p', { class: 'sticky-note-title', text: t('login.dataNoticeTitle') }),
          el('p', { class: 'sticky-note-body', text: t('login.dataNoticeBody') }),
        ],
      ),
    ]),
  );
  emailInput.focus();
}
