/**
 * Liquid Economy lab: a small what-if model of money moving inside and
 * between eight economies.
 *
 * THIS IS A TEACHING MODEL. It is deliberately simple, it uses no market
 * data and no real interest or tax rates, and it forecasts nothing. Every
 * economy starts identical, so that the only differences on screen are
 * the ones the user makes with the two valves.
 *
 * Each economy, each step:
 *
 *   taxes        = income x tax rate              -> spent back by government
 *   disposable   = income - taxes
 *   spending     = disposable x spend share       (people spend less when rates are high)
 *   saving       = disposable - spending          -> into the savings tank
 *   investment   = saving x lend share            (less is borrowed when rates are high)
 *   imports      = 20% of spending + government
 *   exports      = an equal share of everyone else's imports,
 *                  reduced when the currency is strong
 *   income moves toward: spending + government + investment + exports - imports
 *
 * Between economies, savings flow toward higher interest rates. An
 * economy's "pressure" is how attractive it is: money arriving plus half
 * its trade balance, compared with the average of the eight, on a 0-100
 * scale where 50 is average.
 */
import { CURRENCIES, type Currency } from '../data/types';

export const LAB = {
  /** Where every economy starts. Round numbers, not real ones. */
  rate: 3,
  tax: 25,
  income: 100,
  savings: 100,
  rateMin: 0,
  rateMax: 10,
  taxMin: 0,
  taxMax: 50,
  /** Share of disposable income spent at the neutral rate, and how it falls per point of interest. */
  spendShare: 0.8,
  spendPerPoint: 0.04,
  /** How much less of saving is lent on per point of interest above neutral. */
  lendPerPoint: 0.1,
  importShare: 0.2,
  /** Share of a savings tank that moves abroad per unit time, per point of rate advantage. */
  capitalMobility: 0.02,
  /** How much a strong currency cuts exports, at the extremes of pressure. */
  strongCurrencyDrag: 0.3,
  /** How quickly income follows demand. */
  adjustment: 0.5,
  /** Differences in pull smaller than this do not swing pressure to the extremes. */
  pressureFloor: 2,
  /** How fast pressure moves toward its new value, per unit time. */
  pressureSpeed: 2,
} as const;

export interface LabEconomy {
  rate: number;
  tax: number;
  income: number;
  /** The savings tank: a stock that fills and drains. */
  savings: number;
  // The rest are flows per unit time, as of the last step.
  taxes: number;
  spending: number;
  saving: number;
  investment: number;
  imports: number;
  exports: number;
  /** exports - imports. */
  trade: number;
  /** Money arriving from abroad minus money leaving. */
  capital: number;
  /** 0-100, where 50 is the average of the eight economies. */
  pressure: number;
}

export interface LabState {
  time: number;
  economies: Record<Currency, LabEconomy>;
  /** Money moving between two economies per unit time, from the lower-rate to the higher-rate one. */
  flows: { from: Currency; to: Currency; amount: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function freshEconomy(): LabEconomy {
  const taxes = LAB.income * (LAB.tax / 100);
  const disposable = LAB.income - taxes;
  const spending = disposable * LAB.spendShare;
  const saving = disposable - spending;
  const imports = LAB.importShare * (spending + taxes);
  return { rate: LAB.rate, tax: LAB.tax, income: LAB.income, savings: LAB.savings, taxes, spending, saving, investment: saving, imports, exports: imports, trade: 0, capital: 0, pressure: 50 };
}

export function createLab(): LabState {
  return { time: 0, economies: Object.fromEntries(CURRENCIES.map((c) => [c, freshEconomy()])) as Record<Currency, LabEconomy>, flows: [] };
}

/** Turn a valve. Values are kept inside the valve's range. Returns a new state. */
export function setPolicy(state: LabState, currency: Currency, policy: { rate?: number; tax?: number }): LabState {
  const e = state.economies[currency];
  const next: LabEconomy = {
    ...e,
    rate: policy.rate === undefined ? e.rate : clamp(policy.rate, LAB.rateMin, LAB.rateMax),
    tax: policy.tax === undefined ? e.tax : clamp(policy.tax, LAB.taxMin, LAB.taxMax),
  };
  return { ...state, economies: { ...state.economies, [currency]: next } };
}

/** Advance the model by `dt` units of time. Pure: the given state is not changed. */
export function stepLab(state: LabState, dt: number): LabState {
  const prev = state.economies;
  const next = {} as Record<Currency, LabEconomy>;

  // Inside each economy.
  for (const c of CURRENCIES) {
    const e = prev[c];
    const taxes = e.income * (e.tax / 100);
    const disposable = e.income - taxes;
    const spendShare = clamp(LAB.spendShare - LAB.spendPerPoint * (e.rate - LAB.rate), 0.3, 0.95);
    const spending = disposable * spendShare;
    const saving = disposable - spending;
    const lendShare = clamp(1 - LAB.lendPerPoint * (e.rate - LAB.rate), 0, 1.5);
    const investment = saving * lendShare;
    const imports = LAB.importShare * (spending + taxes);
    next[c] = { ...e, taxes, spending, saving, investment, imports, exports: 0, trade: 0, capital: 0 };
  }

  // Trade: each economy's imports are bought from the other seven, a little
  // less from those whose currency is strong. Every import is someone's
  // export, so trade balances always add up to zero across the eight.
  const competitiveness = Object.fromEntries(CURRENCIES.map((c) => [c, 1 - LAB.strongCurrencyDrag * ((prev[c].pressure - 50) / 50)])) as Record<Currency, number>;
  const totalCompetitiveness = CURRENCIES.reduce((sum, c) => sum + competitiveness[c], 0);
  for (const buyer of CURRENCIES) {
    const sellers = totalCompetitiveness - competitiveness[buyer];
    for (const seller of CURRENCIES) {
      if (seller !== buyer) next[seller].exports += (next[buyer].imports * competitiveness[seller]) / sellers;
    }
  }
  for (const c of CURRENCIES) next[c].trade = next[c].exports - next[c].imports;

  // Money between economies: savings move toward higher interest rates.
  const flows: LabState['flows'] = [];
  for (const from of CURRENCIES) {
    for (const to of CURRENCIES) {
      const gap = prev[to].rate - prev[from].rate;
      if (gap <= 0) continue;
      const amount = LAB.capitalMobility * gap * prev[from].savings;
      if (amount <= 0) continue;
      flows.push({ from, to, amount });
      next[from].capital -= amount;
      next[to].capital += amount;
    }
  }

  // Tanks and income move.
  for (const c of CURRENCIES) {
    const e = next[c];
    e.savings = Math.max(0, e.savings + (e.saving - e.investment + e.capital) * dt);
    const demand = e.spending + e.taxes + e.investment + e.exports - e.imports;
    e.income = Math.max(0, e.income + (demand - e.income) * LAB.adjustment * dt);
  }

  // Pressure: how attractive each economy is compared with the average of
  // the eight. The most attractive or least attractive reaches 100 or 0;
  // differences too small to matter stay near 50 instead of being blown up.
  const pull = CURRENCIES.map((c) => next[c].capital + 0.5 * next[c].trade);
  const mean = pull.reduce((a, b) => a + b, 0) / pull.length;
  const spread = Math.max(LAB.pressureFloor, ...pull.map((v) => Math.abs(v - mean)));
  // Pressure glides toward its new value rather than jumping. Because a
  // strong currency in turn cuts exports, a jump would make the two chase
  // each other back and forth from one step to the next.
  const glide = Math.min(1, LAB.pressureSpeed * dt);
  CURRENCIES.forEach((c, i) => {
    const target = clamp(50 + (50 * (pull[i]! - mean)) / spread, 0, 100);
    next[c].pressure = prev[c].pressure + (target - prev[c].pressure) * glide;
  });

  return { time: state.time + dt, economies: next, flows };
}

/** Run the model forward by many small steps. */
export function runLab(state: LabState, steps: number, dt = 0.05): LabState {
  let s = state;
  for (let i = 0; i < steps; i++) s = stepLab(s, dt);
  return s;
}
