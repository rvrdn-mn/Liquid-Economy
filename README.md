# Liquid Markets Desk

Gold and forex terminal with living market visuals: a browser-based desk for
XAU/USD and the 28 major pairs, with a weather map of currency strength and
a liquid machine showing what is moving gold.

**For market context only. Not financial advice.** No buy or sell signals,
no predictions, no AI calls at runtime, no server.

## Status

Phases 0 to 4 are done: the data layer, the terminal shell, the four core
analysis panels, the weather map, replay, the gold drivers and the liquid
machine. Journal and live feeds are next.

| Phase | State |
| --- | --- |
| 0. Data check | Done: sources chosen, adapter interface, price-file importer, sample files |
| 1. Shell | Done: panel grid, saved layout, command bar, chart from imported files |
| 2. Core numbers | Done: strength board, volatility, session clock, linked pairs |
| 3. Weather map | Done: weather map and replay across every panel |
| 4. Gold | Done: gold drivers table and the liquid machine |
| 5. Journal and feeds | Next |
| 6. Polish and release | |

## Using it

- Press `/` and type an instrument (`XAU`, `EURUSD`), a timeframe (`M5`
  `M15` `H1` `H4` `D1`) or a panel code. `HELP` lists every command.
  Several can go on one line: `XAU H1`.
- Unknown input shows the closest matches instead of an error.
- Drag the line between panels to resize. The layout, settings and imported
  files are saved in your browser. Nothing is uploaded.
- Out of the box every panel runs on the daily sample set. For intraday
  views, open `FILES` and import price files. A one-minute file serves
  every timeframe, and files for the seven dollar pairs are enough for all
  28 pairs.
- `STR` strength board, `VOL` volatility, `SES` session clock, `LINK`
  linked pairs. They follow the timeframe selected in the command bar.
- `WX` weather map: strength as pressure, its change as wind, volatility
  as storms.
- `RPL` replay: pick a past moment, then step or play forward. Every panel
  shows only what was known at that moment.
- `DRV` gold drivers and `LIQ` liquid machine: how the dollar, the US
  10-year yield and a risk-mood series have moved with gold. Risk mood is a
  daily file you import in `FILES`.

## Run it

```sh
npm install
npm run dev      # the terminal, at the address it prints
npm test         # unit tests
npm run build    # static site in dist/
```

## Data

How each number is calculated: [docs/CALCULATIONS.md](docs/CALCULATIONS.md).

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for every source, its
delay and its terms. In short: intraday price history comes from files you
import yourself (HistData.com, MT4/MT5 or TradingView exports), near-live gold from gold-api.com, daily reference rates from
Frankfurter, and the 10-year yield from the US Treasury. No free near-live
forex feed met the requirements, so intraday forex is file-only.

The shipped sample files are daily reference rates, one value per day. They
are real published rates but they are not intraday market prices.

## Layout

```
src/data/      data layer: adapters, price-file importer, bar building, browser storage, hub
src/calc/      calculations: pure functions, no data access, no drawing
src/app/       command language, layout tree, saved state, analysis layer (no drawing)
src/ui/        panel grid and command bar
src/panels/    one file per panel; panels get data only from the hub
tests/         unit tests
public/samples sample price files and their manifest
scripts/       sample regeneration
docs/          data sources
```

## Credits

Charts are drawn with [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
(Apache 2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
