// Lightweight i18n: each locale (and each "cursed" variant) is its own flat
// key -> string JSON file under ./locales/, fetched once at startup rather
// than bundled into this module — keeps translations editable as data, not
// buried in JS. t() supports a {name} interpolation syntax.
//
// Deliberately has no dependency on state.js: rows.js (a plain data module
// with no DOM/browser dependency, used directly by the test suite under
// plain Node) imports t() from here, and state.js has browser-only
// top-level side effects (it touches document). Importing state.js's
// notify() here would drag that into every rows.js import. Instead this
// keeps its own tiny listener list — main.js wires it to state's notify()
// once, at the top level, where the app is actually running in a browser.
const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn();
}

export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'en-cursed', label: 'English (cursed)' },
  { code: 'fr', label: 'Français' },
  { code: 'fr-cursed', label: 'Français (cursed)' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-CN-cursed', label: '简体中文 (cursed)' },
];

// Cursed locale files only contain the jokeworthy overrides; anything
// missing there falls back to its non-cursed counterpart, then to English,
// so a key never renders as a raw dictionary miss.
const BASE_OF = { 'en-cursed': 'en', 'fr-cursed': 'fr', 'zh-CN-cursed': 'zh-CN' };

const LANG_KEY = 'meraki-web.language';

function loadLocale() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return LOCALES.some((l) => l.code === stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

let currentLocale = loadLocale();

export function getLocale() {
  return currentLocale;
}

export function setLocale(code) {
  if (!LOCALES.some((l) => l.code === code) || code === currentLocale) return;
  currentLocale = code;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    // best-effort; falls back to 'en' next load
  }
  loadDictionary(code);
  notify();
}

const dictionaries = {};
const loading = {};

function localeUrl(code) {
  return new URL(`./locales/${code}.json`, import.meta.url);
}

// Browser: fetch. Plain Node (e.g. the test suite importing this module
// directly, with no bundler and no <script type=module> host) has no fetch
// for file: URLs, so fall back to reading the file straight off disk —
// node:fs accepts a file:// URL object as-is, so localeUrl() needs no
// special-casing between the two paths.
function fetchJson(url) {
  if (typeof window !== 'undefined') {
    return fetch(url).then((res) => res.json());
  }
  return import('node:fs/promises').then(({ readFile }) => readFile(url, 'utf8')).then((text) => JSON.parse(text));
}

function loadDictionary(code) {
  if (dictionaries[code] || loading[code]) return loading[code];
  loading[code] = fetchJson(localeUrl(code))
    .then((json) => {
      dictionaries[code] = json;
      notify();
    })
    .catch(() => {
      dictionaries[code] = {};
    });
  return loading[code];
}

// Kick off every locale's fetch immediately: they're tiny JSON files served
// alongside the app, and having them all in flight from startup means a
// language switch never has to wait on a network round trip.
export const i18nReady = Promise.all(LOCALES.map((l) => loadDictionary(l.code)));

function lookup(locale, key) {
  return dictionaries[locale]?.[key];
}

export function t(key, vars) {
  const base = BASE_OF[currentLocale];
  const raw = lookup(currentLocale, key) ?? (base && lookup(base, key)) ?? lookup('en', key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
