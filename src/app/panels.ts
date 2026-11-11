/** The panel catalogue: codes typed in the command bar and what they open. */

export const PANEL_CODES = [
  'CHART', 'STR', 'WX', 'DRV', 'LIQ', 'SES', 'VOL', 'LINK', 'CAL', 'NEWS', 'JRN', 'RPL', 'FILES', 'HELP',
] as const;
export type PanelCode = (typeof PANEL_CODES)[number];

export interface PanelInfo {
  code: PanelCode;
  title: string;
  description: string;
  /** Why the panel is not available yet; absent when it is built. */
  pending?: string;
}

export const PANELS: Record<PanelCode, PanelInfo> = {
  CHART: { code: 'CHART', title: 'Chart', description: 'Candlesticks for the selected instrument' },
  FILES: { code: 'FILES', title: 'Files', description: 'Import and manage price files' },
  HELP: { code: 'HELP', title: 'Help', description: 'Every command' },
  STR: { code: 'STR', title: 'Strength board', description: 'Eight currencies ranked strongest to weakest' },
  VOL: { code: 'VOL', title: 'Volatility', description: 'Each pair against its own recent average' },
  SES: { code: 'SES', title: 'Session clock', description: 'Asia, London and New York on a 24-hour dial' },
  LINK: { code: 'LINK', title: 'Linked pairs', description: 'Correlation grid for the watchlist' },
  WX: { code: 'WX', title: 'Weather map', description: 'Currency strength drawn as weather', pending: 'Built in phase 3.' },
  RPL: { code: 'RPL', title: 'Replay', description: 'Rewind every panel to a past time' },
  DRV: { code: 'DRV', title: 'Gold drivers', description: 'How the dollar, yields and risk mood move with gold', pending: 'Built in phase 4.' },
  LIQ: { code: 'LIQ', title: 'Liquid machine', description: 'Tanks and pipes showing what is moving gold', pending: 'Built in phase 4.' },
  JRN: { code: 'JRN', title: 'Journal', description: 'Trade history, statistics and chart markers', pending: 'Built in phase 5.' },
  NEWS: { code: 'NEWS', title: 'News', description: 'Central-bank headlines', pending: 'Built in phase 5.' },
  CAL: {
    code: 'CAL',
    title: 'Calendar',
    description: 'Upcoming economic releases',
    pending: 'Left out of version 1: no free calendar source was found whose terms allow it. See the data sources page.',
  },
};

export function isPanelCode(s: string): s is PanelCode {
  return (PANEL_CODES as readonly string[]).includes(s);
}
