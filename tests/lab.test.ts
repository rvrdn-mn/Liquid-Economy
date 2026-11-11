import { describe, expect, it } from 'vitest';
import { createLab, LAB, runLab, setPolicy, stepLab } from '../src/calc/lab';
import { CURRENCIES } from '../src/data/types';

describe('Liquid Economy lab (teaching model)', () => {
  it('starts with eight identical economies and stays still when nothing is touched', () => {
    const start = createLab();
    const later = runLab(start, 400);
    for (const c of CURRENCIES) {
      const e = later.economies[c];
      expect(e.income).toBeCloseTo(100, 6);
      expect(e.savings).toBeCloseTo(100, 6);
      expect(e.trade).toBeCloseTo(0, 6);
      expect(e.capital).toBe(0);
      expect(e.pressure).toBe(50);
    }
    expect(later.flows).toEqual([]);
    // The starting flows add up: 100 of income becomes 60 spending + 25 government + 15 investment.
    const e = start.economies.USD;
    expect([e.taxes, e.spending, e.saving, e.investment, e.imports]).toEqual([25, 60, 15, 15, 17]);
  });

  it('raising one interest rate draws money in and lifts that currency\'s pressure', () => {
    const s = runLab(setPolicy(createLab(), 'USD', { rate: 6 }), 60);
    const usd = s.economies.USD;
    expect(usd.capital).toBeGreaterThan(0);
    expect(usd.pressure).toBeGreaterThan(95);
    expect(usd.savings).toBeGreaterThan(110); // the tank fills
    for (const c of CURRENCIES.filter((x) => x !== 'USD')) {
      expect(s.economies[c].capital, c).toBeLessThan(0);
      expect(s.economies[c].savings, c).toBeLessThan(100); // their tanks drain
      expect(s.economies[c].pressure, c).toBeLessThan(usd.pressure);
    }
    // Every flow runs toward the higher rate.
    expect(s.flows).toHaveLength(7);
    expect(s.flows.every((f) => f.to === 'USD' && f.amount > 0)).toBe(true);
  });

  it('a higher rate cools that economy: less spending, less borrowing, lower income', () => {
    const s = runLab(setPolicy(createLab(), 'EUR', { rate: 6 }), 60);
    const eur = s.economies.EUR;
    const gbp = s.economies.GBP;
    expect(eur.spending).toBeLessThan(gbp.spending);
    expect(eur.investment).toBeLessThan(eur.saving); // not all saving is lent on
    expect(eur.income).toBeLessThan(100);
    // A strong currency sells less abroad.
    expect(eur.trade).toBeLessThan(0);
  });

  it('a lower rate does the opposite', () => {
    const s = runLab(setPolicy(createLab(), 'JPY', { rate: 0.5 }), 60);
    const jpy = s.economies.JPY;
    expect(jpy.capital).toBeLessThan(0);
    expect(jpy.pressure).toBeLessThan(5);
    expect(jpy.spending).toBeGreaterThan(s.economies.USD.spending);
    expect(jpy.income).toBeGreaterThan(100);
  });

  it('a higher tax moves spending from households to government', () => {
    const one = stepLab(setPolicy(createLab(), 'CAD', { tax: 35 }), 0.05);
    const cad = one.economies.CAD;
    expect(cad.taxes).toBeCloseTo(35, 9);
    expect(cad.spending).toBeCloseTo(65 * 0.8, 9);
    expect(cad.spending).toBeLessThan(one.economies.USD.spending);
    expect(cad.taxes).toBeGreaterThan(one.economies.USD.taxes);
  });

  it('money that leaves one economy arrives in another: none is created or lost', () => {
    let s = setPolicy(createLab(), 'USD', { rate: 7 });
    s = setPolicy(s, 'AUD', { rate: 1 });
    s = runLab(s, 30);
    const net = CURRENCIES.reduce((sum, c) => sum + s.economies[c].capital, 0);
    expect(net).toBeCloseTo(0, 9);
    expect(s.flows.reduce((sum, f) => sum + f.amount, 0)).toBeGreaterThan(0);
  });

  it('keeps valves inside their range and never changes the state it was given', () => {
    const start = createLab();
    const frozen = JSON.stringify(start);
    const wild = setPolicy(start, 'CHF', { rate: 99, tax: -20 });
    expect(wild.economies.CHF.rate).toBe(LAB.rateMax);
    expect(wild.economies.CHF.tax).toBe(LAB.taxMin);
    stepLab(start, 0.1);
    runLab(wild, 20);
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it('stays finite and non-negative even at the extremes', () => {
    let s = createLab();
    CURRENCIES.forEach((c, i) => {
      s = setPolicy(s, c, { rate: i % 2 === 0 ? 10 : 0, tax: i % 3 === 0 ? 50 : 0 });
    });
    s = runLab(s, 4000);
    for (const c of CURRENCIES) {
      const e = s.economies[c];
      for (const v of [e.income, e.savings, e.spending, e.pressure]) {
        expect(Number.isFinite(v), c).toBe(true);
        expect(v, c).toBeGreaterThanOrEqual(0);
      }
      expect(e.pressure).toBeLessThanOrEqual(100);
    }
  });

  it('moves smoothly: nothing flips back and forth from one step to the next', () => {
    let s = setPolicy(createLab(), 'NZD', { rate: 8 });
    s = runLab(s, 100);
    s = runLab(setPolicy(s, 'NZD', { rate: LAB.rate }), 400);
    const a = stepLab(s, 0.05);
    const b = stepLab(a, 0.05);
    for (const c of CURRENCIES) {
      expect(Math.abs(a.economies[c].pressure - s.economies[c].pressure), c).toBeLessThan(1);
      expect(Math.abs(b.economies[c].exports - a.economies[c].exports), c).toBeLessThan(0.05);
    }
  });

  it('every import is another economy\'s export', () => {
    let s = setPolicy(createLab(), 'USD', { rate: 8 });
    s = setPolicy(s, 'GBP', { tax: 45 });
    s = runLab(s, 80);
    const balance = CURRENCIES.reduce((sum, c) => sum + s.economies[c].trade, 0);
    expect(balance).toBeCloseTo(0, 9);
  });

  it('settles again when the valve is put back, though not where it began', () => {
    let s = runLab(setPolicy(createLab(), 'NZD', { rate: 8 }), 100);
    s = runLab(setPolicy(s, 'NZD', { rate: LAB.rate }), 4000);
    expect(s.flows).toEqual([]);
    const incomes = CURRENCIES.map((c) => s.economies[c].income);
    // Incomes even out across the eight, and trade and pressure return to neutral.
    expect(Math.max(...incomes) - Math.min(...incomes)).toBeLessThan(0.01);
    for (const c of CURRENCIES) {
      expect(s.economies[c].trade, c).toBeCloseTo(0, 2);
      expect(Math.abs(s.economies[c].pressure - 50), c).toBeLessThan(1);
    }
    // The money that moved stays where it went: tanks do not snap back.
    expect(s.economies.NZD.savings).toBeGreaterThan(s.economies.USD.savings);
  });
});
