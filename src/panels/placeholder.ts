/** Stand-in for panels that are planned but not built, so codes never error. */
import { PANELS, type PanelCode } from '../app/panels';
import { h } from '../ui/dom';
import type { PanelFactory } from './types';

export const placeholderPanel =
  (code: PanelCode): PanelFactory =>
  (body, footer) => {
    const info = PANELS[code];
    body.append(
      h('div', { class: 'panel-empty' }, h('p', { class: 'empty-title' }, `${info.title} is not available yet.`), h('p', {}, info.description + '.'), h('p', { class: 'dim' }, info.pending ?? '')),
    );
    footer.textContent = 'No data shown.';
    return { destroy() {} };
  };
