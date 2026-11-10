import { describe, expect, it } from 'vitest';
import { editDistance, parseCommand, suggest, VOCABULARY } from '../src/app/commands';

describe('parseCommand', () => {
  it('reads instruments in the forms people type', () => {
    expect(parseCommand('XAU')).toEqual([{ kind: 'instrument', instrument: 'XAUUSD' }]);
    expect(parseCommand('gold')).toEqual([{ kind: 'instrument', instrument: 'XAUUSD' }]);
    expect(parseCommand('eurusd')).toEqual([{ kind: 'instrument', instrument: 'EURUSD' }]);
    expect(parseCommand('EUR/USD')).toEqual([{ kind: 'instrument', instrument: 'EURUSD' }]);
    expect(parseCommand('eur usd')).toEqual([{ kind: 'instrument', instrument: 'EURUSD' }]);
  });

  it('reads timeframes and panel codes', () => {
    expect(parseCommand('h1')).toEqual([{ kind: 'timeframe', timeframe: 'H1' }]);
    expect(parseCommand('D1')).toEqual([{ kind: 'timeframe', timeframe: 'D1' }]);
    expect(parseCommand('wx')).toEqual([{ kind: 'panel', code: 'WX' }]);
    expect(parseCommand('HELP')).toEqual([{ kind: 'panel', code: 'HELP' }]);
  });

  it('takes several commands at once', () => {
    expect(parseCommand('  XAU   H1 ')).toEqual([
      { kind: 'instrument', instrument: 'XAUUSD' },
      { kind: 'timeframe', timeframe: 'H1' },
    ]);
    expect(parseCommand('gbpjpy m15 chart')).toEqual([
      { kind: 'instrument', instrument: 'GBPJPY' },
      { kind: 'timeframe', timeframe: 'M15' },
      { kind: 'panel', code: 'CHART' },
    ]);
  });

  it('answers unknown input with the closest matches, never an error', () => {
    const [typo] = parseCommand('EURSUD');
    expect(typo).toMatchObject({ kind: 'unknown', input: 'EURSUD' });
    expect(typo!.kind === 'unknown' && typo!.suggestions.map((s) => s.text)).toContain('EURUSD');

    const [tf] = parseCommand('H2');
    expect(tf!.kind === 'unknown' && tf!.suggestions.map((s) => s.text)).toEqual(expect.arrayContaining(['H1', 'H4']));

    const [none] = parseCommand('zzzzzz');
    expect(none).toEqual({ kind: 'unknown', input: 'zzzzzz', suggestions: [] });
    expect(parseCommand('')).toEqual([]);
  });

  it('keeps the good parts of a mixed line', () => {
    const cmds = parseCommand('XAU H7');
    expect(cmds[0]).toEqual({ kind: 'instrument', instrument: 'XAUUSD' });
    expect(cmds[1]!.kind).toBe('unknown');
  });
});

describe('suggest', () => {
  it('lists a currency\'s pairs when only the currency is typed', () => {
    const eur = suggest('EUR', 10).map((s) => s.text);
    expect(eur.slice(0, 7).sort()).toEqual(['EURAUD', 'EURCAD', 'EURCHF', 'EURGBP', 'EURJPY', 'EURNZD', 'EURUSD']);
    expect(suggest('JPY', 10).map((s) => s.text)).toEqual(expect.arrayContaining(['USDJPY', 'EURJPY', 'CHFJPY']));
  });

  it('completes from the first letters', () => {
    expect(suggest('XA')[0]!.text).toBe('XAU');
    expect(suggest('CH').map((s) => s.text)).toEqual(expect.arrayContaining(['CHART', 'CHFJPY']));
    expect(suggest('')).toEqual([]);
  });

  it('describes what each entry does', () => {
    expect(VOCABULARY.find((v) => v.text === 'WX')!.description).toMatch(/Weather map/);
    expect(VOCABULARY.find((v) => v.text === 'EURUSD')!.description).toBe('EUR / USD');
  });
});

describe('editDistance', () => {
  it('counts single slips', () => {
    expect(editDistance('EURUSD', 'EURUSD')).toBe(0);
    expect(editDistance('EURUSD', 'EURUSF')).toBe(1);
    expect(editDistance('EURSUD', 'EURUSD')).toBe(1); // swapped neighbours
    expect(editDistance('CHAR', 'CHART')).toBe(1);
    expect(editDistance('ABC', 'XYZ')).toBe(3);
  });
});
