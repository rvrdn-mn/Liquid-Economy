# Liquid Markets Desk

![The weather map and the liquid machine replaying sample data](docs/media/demo.gif)

**Live demo:** https://rvrdn-mn.github.io/Liquid-Economy/
(published by the workflow in this repository once GitHub Pages is switched
on for it; see [Publishing](#publishing))

Gold and forex terminal with living market visuals. A browser-based desk for
XAU/USD and the 28 major pairs, with the dense, keyboard-driven feel of a
market terminal and two views of its own: a **weather map** of currency
strength and a **liquid machine** showing what is moving gold.

**For market context only. Not financial advice.** No buy or sell signals,
no predictions, no order placement, no accounts, no AI calls at runtime, and
no server: it runs entirely in your browser.

## What is in it

| Code | Panel | What it shows |
| --- | --- | --- |
| `CHART` | Chart | Candlesticks, timeframe switcher, crosshair, journal trades as entry and exit marks |
| `STR` | Strength board | The eight currencies ranked strongest to weakest, with history |
| `WX` | Weather map | Strength as pressure, its change as wind, volatility as storms |
| `DRV` | Gold drivers | How the dollar, the US 10-year yield and risk mood move with gold |
| `LIQ` | Liquid machine | Tanks for each driver piped into a gold tank |
| `SES` | Session clock | Asia, London and New York on a 24-hour dial, with hourly ranges |
| `VOL` | Volatility | Each instrument against its own recent average |
| `LINK` | Linked pairs | Correlation grid for the watchlist |
| `NEWS` | News | Press-release headlines from central banks |
| `JRN` | Journal | Trade history, statistics, chart marks |
| `RPL` | Replay | Rewind every panel to a past moment, then step or play |
| `FILES` | Files | Import price files, a risk-mood file |
| `SET` | Settings | Every adjustable default, the watchlist, layout, stored data |
| `LAB` | Liquid Economy lab | A what-if teaching model, separate from the analysis |
| `HELP` | Help | Every command |

`CAL` (calendar) is left out of version 1: no free calendar source was
found whose terms allow it.

## Using it

- Press `/` and type an instrument (`XAU`, `EURUSD`), a timeframe (`M5`
  `M15` `H1` `H4` `D1`) or a panel code. Several can go on one line:
  `XAU H1`. Unknown input shows the closest matches instead of an error.
- Drag the line between panels to resize; the × closes a panel. The
  layout, settings and imported files are saved in your browser. Nothing
  is uploaded.
- Every panel says where its data came from and how old it is. Nothing is
  shown as live unless it is, and missing data is shown as missing.

### What you see before importing anything

- **Sample set:** one reference rate per day for gold and the 28 pairs,
  about a year, from Frankfurter. Real published rates, but not intraday
  market prices: they have no daily range and gold trails the market by
  about a day.
- **US 10-year yield:** fetched from the US Treasury, with a saved copy as
  fallback.
- **Live gold price:** from gold-api.com, with its age shown.
- **Headlines:** from five central banks, copied when the site is built.
- **Demo journal:** invented example trades, marked DEMO. Nobody placed
  them.

### Importing your own data

In `FILES`:

- **Price files.** One-minute files from histdata.com (MetaTrader format)
  work as they are; MT4/MT5 exports and TradingView chart exports are also
  read. A one-minute file serves every timeframe, and files for XAUUSD and
  the seven dollar pairs (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF,
  USDJPY) cover all 28 pairs.
- **Risk mood.** Any daily "date, value" CSV, such as a volatility index
  history.

In `JRN`: your trade history, as a table with a header row. See
[docs/CALCULATIONS.md](docs/CALCULATIONS.md#journal-statistics-jrn) for the
layout.

Check the terms of any file you import. Your files stay in your browser.

## How the numbers are made

Plain arithmetic on price bars, in small tested functions kept apart from
the drawing code. [docs/CALCULATIONS.md](docs/CALCULATIONS.md) explains
each one in plain language and says how it was checked.

## Where the data comes from

[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) lists every source, its delay
and its terms, including the ones that were checked and turned down. In
short: no free feed gives intraday forex with the right to show it
publicly, so intraday data comes from files you import.

## Run it yourself

Needs Node 22.18 or later.

```sh
npm install
npm run dev      # the terminal, at the address it prints
npm test         # unit tests
npm run build    # static site in dist/
```

Refreshing the shipped data (each script says what it fetches):

```sh
npm run samples:fetch     # daily reference rates
npm run samples:yield     # US 10-year yield snapshot
npm run samples:journal   # the demo journal
npm run news:fetch        # central-bank headlines
npm run map:build         # weather-map outlines
```

## Publishing

`.github/workflows/deploy.yml` tests, refreshes the headlines, builds and
publishes to GitHub Pages on every push to `main`, and again every six
hours so the headlines stay fresh. One setting has to be switched on once,
by the repository owner: **Settings → Pages → Source: GitHub Actions**.

## Code layout

```
src/data/      data layer: adapters, file readers, bar building, browser storage, hub
src/calc/      calculations: pure functions, no data access, no drawing
src/app/       command language, layout tree, saved state, analysis layer (no drawing)
src/ui/        panel grid and command bar
src/panels/    one file or folder per panel; panels get data only from the hub
tests/         unit tests
public/        sample prices, yield snapshot, demo journal, headlines
scripts/       scripts that regenerate the files in public/
docs/          calculations, data sources, the demo clip
```

Three layers are kept apart: data adapters, calculation functions, and
panels. Panels never fetch data themselves.

## Licence and credits

[MIT](LICENSE). Charts are drawn with
[TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
(Apache 2.0); map outlines are from Natural Earth (public domain). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
