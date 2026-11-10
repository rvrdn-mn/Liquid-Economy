import type { AppState } from '../app/state';
import type { DataHub } from '../data/hub';

export interface PanelContext {
  state: AppState;
  hub: DataHub;
  /** Run command-bar text, e.g. "FILES" or "XAU H1". */
  run(text: string): void;
}

export interface PanelInstance {
  destroy(): void;
}

/**
 * A panel draws into `body` and reports where its data came from and how
 * old it is in `footer`. It gets data only through `ctx.hub`.
 */
export type PanelFactory = (body: HTMLElement, footer: HTMLElement, ctx: PanelContext) => PanelInstance;
