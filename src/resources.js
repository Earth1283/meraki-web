import { el, svgIcon } from './dom.js';
import { iconPaths } from './icons.js';
import { closeOverlay } from './state.js';
import { backdrop, closeButton } from './panels.js';
import { t } from './i18n.js';

const RESOURCES = [
  { key: 'ccssEla', url: 'https://corestandards.org/wp-content/uploads/2023/09/ELA_Standards1.pdf', domain: 'corestandards.org' },
];

function resourceLink({ key, url, domain }) {
  return el('a', { class: 'resource-link', href: url, target: '_blank', rel: 'noopener' }, [
    el('span', { class: 'resource-link-icon' }, [svgIcon(iconPaths('book'))]),
    el('span', { class: 'resource-link-copy' }, [
      el('span', { class: 'resource-link-title', text: t(`resources.${key}.title`) }),
      el('span', { class: 'resource-link-desc', text: t(`resources.${key}.desc`) }),
      el('span', { class: 'resource-link-domain', text: domain }),
    ]),
    el('span', { class: 'resource-link-go' }, [svgIcon(iconPaths('open'))]),
  ]);
}

export function buildResources() {
  const panel = el('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('resources.title') }, [
    el('div', { class: 'panel-header' }, [el('h2', { text: t('resources.title') }), closeButton()]),
    el('div', { class: 'resource-links' }, RESOURCES.map(resourceLink)),
    el('p', { class: 'help-note', text: t('resources.note') }),
  ]);
  return el('div', { class: 'overlay-right' }, [backdrop(closeOverlay), panel]);
}
