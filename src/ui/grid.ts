/**
 * Draws the layout tree as nested, resizable panels. Panel instances are
 * kept alive across redraws, so opening one panel does not rebuild the rest.
 */
import { closePanel, leaves, setRatio, MIN_RATIO, MAX_RATIO, type LayoutNode } from '../app/layout';
import { PANELS, type PanelCode } from '../app/panels';
import type { PanelContext, PanelFactory, PanelInstance } from '../panels/types';
import { h } from './dom';

interface Mounted {
  frame: HTMLElement;
  instance: PanelInstance;
}

export class Grid {
  private readonly mounted = new Map<string, Mounted>();

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: PanelContext,
    private readonly factories: (code: PanelCode) => PanelFactory,
  ) {
    ctx.state.onLayout(() => this.render());
    this.render();
  }

  render(): void {
    const { layout } = this.ctx.state;
    const live = new Set(leaves(layout.root).map((l) => l.id));
    for (const [id, m] of this.mounted) {
      if (live.has(id)) continue;
      m.instance.destroy();
      m.frame.remove();
      this.mounted.delete(id);
    }
    if (!layout.root) {
      this.root.replaceChildren(
        h('div', { class: 'empty-desk' }, h('p', {}, 'No panels are open.'), h('p', { class: 'dim' }, 'Press / and type a panel code such as CHART, or HELP to see every command.')),
      );
      return;
    }
    this.root.replaceChildren(this.build(layout.root, []));
  }

  flash(id: string): void {
    const frame = this.mounted.get(id)?.frame;
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
    const existing = this.mounted.get(id);
    if (existing) return existing.frame;

    const info = PANELS[code];
    const body = h('div', { class: 'panel-body' });
    const footer = h('div', { class: 'panel-footer' });
    const close = h('button', { class: 'panel-close', type: 'button', title: `Close ${info.title}`, 'aria-label': `Close ${info.title}` }, '×');
    close.addEventListener('click', () => this.ctx.state.setLayout(closePanel(this.ctx.state.layout, id)));
    const frame = h(
      'section',
      { class: 'panel', 'data-panel': code },
      h('header', { class: 'panel-header' }, h('span', { class: 'panel-title' }, info.title), h('span', { class: 'panel-code' }, code), close),
      body,
      footer,
    );
    const instance = this.factories(code)(body, footer, this.ctx);
    this.mounted.set(id, { frame, instance });
    return frame;
  }
}
