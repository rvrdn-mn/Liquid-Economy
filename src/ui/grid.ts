/**
 * Draws the layout tree as nested, resizable panels. Panel instances are
 * kept alive across redraws, so opening one panel does not rebuild the rest.
 */
import { closePanel, leaves, setRatio, MIN_RATIO, MAX_RATIO, type LayoutNode } from '../app/layout';
import { PANELS, type PanelCode } from '../app/panels';
import type { PanelContext, PanelFactory, PanelInstance } from '../panels/types';
import { h } from './dom';
import { icon } from './icons';

interface Mounted {
  frame: HTMLElement;
  instance: PanelInstance;
}

export class Grid {
  private readonly mounted = new Map<string, Mounted>();
  private page = '';
  /** Panel ids repeat from page to page, so a mounted panel is known by page and id. */
  private key(id: string): string {
    return `${this.page}:${id}`;
  }

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: PanelContext,
    private readonly factories: (code: PanelCode) => PanelFactory,
  ) {
    ctx.state.onLayout(() => this.render());
    this.render();
  }

  render(): void {
    const { layout, workspace } = this.ctx.state;
    this.page = workspace;
    const live = new Set(leaves(layout.root).map((l) => this.key(l.id)));
    for (const [id, m] of this.mounted) {
      if (live.has(id)) continue;
      m.instance.destroy();
      m.frame.remove();
      this.mounted.delete(id);
    }
    if (!layout.root) {
      this.root.replaceChildren(
        h('div', { class: 'empty-desk' }, h('p', {}, 'This page is empty.'), h('p', { class: 'dim' }, 'Press / and type a panel name such as CHART, or restore the page in Settings.')),
      );
      return;
    }
    this.root.replaceChildren(this.build(layout.root, []));
  }

  flash(id: string): void {
    const frame = this.mounted.get(this.key(id))?.frame;
    if (!frame) return;
    frame.classList.remove('flash');
    void frame.offsetWidth; // restart the animation
    frame.classList.add('flash');
  }

  private build(node: LayoutNode, path: ('a' | 'b')[]): HTMLElement {
    if (node.type === 'leaf') return this.frame(node.id, node.panel);

    const a = h('div', { class: 'pane' }, this.build(node.a, [...path, 'a']));
    const b = h('div', { class: 'pane' }, this.build(node.b, [...path, 'b']));
    const splitter = h('div', {
      class: 'splitter',
      role: 'separator',
      'aria-orientation': node.dir === 'row' ? 'vertical' : 'horizontal',
      title: 'Drag to resize',
    });
    const box = h('div', { class: `split ${node.dir}` }, a, splitter, b);
    const apply = (ratio: number) => {
      a.style.flex = `${ratio} 1 0`;
      b.style.flex = `${1 - ratio} 1 0`;
    };
    apply(node.ratio);

    splitter.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      splitter.setPointerCapture(down.pointerId);
      splitter.classList.add('dragging');
      let ratio = node.ratio;
      const move = (ev: PointerEvent) => {
        const rect = box.getBoundingClientRect();
        const raw = node.dir === 'row' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));
        apply(ratio);
      };
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.classList.remove('dragging');
        // Saved quietly: the DOM already shows the new size.
        this.ctx.state.setLayout(setRatio(this.ctx.state.layout, path, ratio), true);
        node.ratio = ratio;
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up, { once: true });
      splitter.addEventListener('pointercancel', up, { once: true });
    });
    return box;
  }

  private frame(id: string, code: PanelCode): HTMLElement {
    const existing = this.mounted.get(this.key(id));
    if (existing) return existing.frame;

    const info = PANELS[code];
    const body = h('div', { class: 'panel-body' });
    const footer = h('div', { class: 'panel-footer' });
    const about = h('button', { type: 'button', class: 'panel-tool', title: 'How to read this', 'aria-label': `How to read ${info.title}`, 'aria-pressed': 'false', hidden: true }, icon('info', 15));
    const close = h('button', { type: 'button', class: 'panel-tool', title: `Close ${info.title}`, 'aria-label': `Close ${info.title}` }, icon('close', 15));
    close.addEventListener('click', () => this.ctx.state.setLayout(closePanel(this.ctx.state.layout, id)));
    const frame = h(
      'section',
      { class: 'panel', 'data-panel': code, 'aria-label': info.title },
      h('header', { class: 'panel-header' }, h('h2', { class: 'panel-title' }, info.title), h('span', { class: 'panel-tools' }, about, close)),
      body,
      footer,
    );
    // Explanations are written by each panel as ".note" paragraphs. They stay
    // out of the way until asked for, so the numbers get the space.
    about.addEventListener('click', () => {
      const on = frame.classList.toggle('show-notes');
      about.setAttribute('aria-pressed', String(on));
    });
    const watch = new MutationObserver(() => {
      about.hidden = body.querySelector('.note:not(.warn)') === null;
      footer.title = footer.textContent ?? '';
    });
    watch.observe(body, { childList: true, subtree: true });
    watch.observe(footer, { childList: true, characterData: true, subtree: true });

    let instance: PanelInstance;
    try {
      instance = this.factories(code)(body, footer, this.ctx);
    } catch (err) {
      body.replaceChildren(h('div', { class: 'panel-empty' }, h('p', { class: 'empty-title' }, `${info.title} could not start.`), h('p', { class: 'dim' }, (err as Error).message), h('p', { class: 'dim' }, 'The other panels are not affected. Closing and reopening this one may help.')));
      footer.textContent = 'Not running';
      instance = { destroy() {} };
    }
    const destroy = instance.destroy.bind(instance);
    instance = {
      destroy() {
        watch.disconnect();
        destroy();
      },
    };
    this.mounted.set(this.key(id), { frame, instance });
    return frame;
  }
}
