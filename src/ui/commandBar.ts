/** The command input: always reachable with the / key. */
import { parseCommand, suggest, type Command, type Suggestion } from '../app/commands';
import { h } from './dom';

export interface CommandBarOptions {
  /** Apply the commands that were understood. */
  execute(commands: Command[]): void;
}

export class CommandBar {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private items: Suggestion[] = [];
  private active = -1;

  constructor(private readonly options: CommandBarOptions) {
    this.input = h('input', {
      class: 'command-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'characters',
      'aria-label': 'Command',
      placeholder: 'Press /  then an instrument, timeframe or panel. HELP lists everything.',
    });
    this.list = h('ul', { class: 'command-suggestions', role: 'listbox', hidden: true });
    this.note = h('div', { class: 'command-note', 'aria-live': 'polite' });
    this.el = h('div', { class: 'command-bar' }, h('span', { class: 'command-prompt', 'aria-hidden': 'true' }, '/'), this.input, this.list, this.note);

    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('focus', () => this.refresh());
    this.input.addEventListener('blur', () => setTimeout(() => this.hideList(), 120));
    this.input.addEventListener('keydown', (ev) => this.onKey(ev));

    document.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (ev.key === '/' && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        this.focus();
      }
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** Run text as if it had been typed and entered. */
  run(text: string): void {
    const commands = parseCommand(text);
    const unknown = commands.filter((c) => c.kind === 'unknown');
    this.options.execute(commands.filter((c) => c.kind !== 'unknown'));
    if (unknown.length === 0) {
      this.input.value = '';
      this.setNote([]);
      this.hideList();
      this.input.blur();
      return;
    }
    // Keep only what was not understood so it can be corrected.
    this.input.value = unknown.map((c) => c.input).join(' ');
    this.hideList();
    this.setNote(unknown);
  }

  private setNote(unknown: Extract<Command, { kind: 'unknown' }>[]): void {
    this.note.replaceChildren();
    for (const u of unknown) {
      const line = h('div', { class: 'command-note-line' });
      if (u.suggestions.length === 0) {
        line.append(`Nothing matches "${u.input}". Type HELP to see every command.`);
      } else {
        line.append(`"${u.input}" is not a command. Closest: `);
        for (const s of u.suggestions) {
          const b = h('button', { type: 'button', class: 'chip', title: s.description }, s.text);
          b.addEventListener('click', () => {
            const rest = this.input.value.split(/\s+/).filter((t) => t && t !== u.input);
            this.run([...rest, s.text].join(' '));
          });
          line.append(b);
        }
      }
      this.note.append(line);
    }
  }

  private lastToken(): string {
    return this.input.value.split(/\s+/).pop() ?? '';
  }

  private refresh(): void {
    this.items = suggest(this.lastToken(), 8);
    this.active = -1;
    if (this.items.length === 0) return this.hideList();
    this.list.replaceChildren(
      ...this.items.map((s, i) => {
        const li = h('li', { role: 'option', 'data-index': String(i) }, h('span', { class: 'sug-text' }, s.text), h('span', { class: 'sug-desc' }, s.description));
        li.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this.choose(i);
          this.run(this.input.value);
        });
        return li;
      }),
    );
    this.list.hidden = false;
  }

  private hideList(): void {
    this.list.hidden = true;
    this.active = -1;
  }

  private choose(i: number): void {
    const s = this.items[i];
    if (!s) return;
    const tokens = this.input.value.split(/\s+/);
    tokens[tokens.length - 1] = s.text;
    this.input.value = tokens.join(' ');
  }

  private highlight(): void {
    [...this.list.children].forEach((li, i) => li.classList.toggle('active', i === this.active));
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      this.hideList();
      this.input.blur();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (this.list.hidden || this.items.length === 0) return;
      ev.preventDefault();
      const step = ev.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.items.length) % this.items.length;
      this.highlight();
    } else if (ev.key === 'Tab' && !this.list.hidden && this.items.length > 0) {
      ev.preventDefault();
      this.choose(this.active >= 0 ? this.active : 0);
      this.refresh();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (this.active >= 0) this.choose(this.active);
      this.run(this.input.value);
    }
  }
}
