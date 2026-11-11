/** The sidebar: the pages of the app, always visible, one click each. */
import type { AppState } from '../app/state';
import { WORKSPACE_IDS, WORKSPACES, type WorkspaceId } from '../app/workspaces';
import { h } from './dom';
import { icon } from './icons';

const GROUP_TITLES = { analysis: 'Analysis', records: 'Records', tools: 'Tools', system: '' } as const;

export function createSidebar(state: AppState): HTMLElement {
  const buttons = new Map<WorkspaceId, HTMLButtonElement>();
  const item = (id: WorkspaceId) => {
    const info = WORKSPACES[id];
    const b = h('button', { type: 'button', class: 'nav-item', title: info.summary }, icon(id, 17), h('span', { class: 'nav-label' }, info.name));
    b.addEventListener('click', () => state.setWorkspace(id));
    buttons.set(id, b);
    return b;
  };
  const group = (key: keyof typeof GROUP_TITLES) => {
    const ids = WORKSPACE_IDS.filter((id) => WORKSPACES[id].group === key);
    const box = h('div', { class: 'nav-group' });
    if (GROUP_TITLES[key]) box.append(h('div', { class: 'nav-heading' }, GROUP_TITLES[key]));
    box.append(...ids.map(item));
    return box;
  };

  const nav = h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Pages' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, 'Liquid Markets Desk')),
    group('analysis'),
    group('records'),
    group('tools'),
    h('div', { class: 'nav-spacer' }),
    group('system'),
    h('p', { class: 'nav-note' }, 'For market context only. Not financial advice.'),
  );

  const sync = () => {
    for (const [id, b] of buttons) {
      const on = id === state.workspace;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  };
  state.onLayout(sync);
  sync();
  return nav;
}
