# Liquid Markets Desk

Gold and forex terminal with living market visuals: a browser-based desk for
XAU/USD and the 28 major pairs, with a weather map of currency strength and
a liquid machine showing what is moving gold.

**For market context only. Not financial advice.** No buy or sell signals,
no predictions, no AI calls at runtime, no server.

## Status

Phase 0 (data check) is done. The panels are not built yet.

| Phase | State |
| --- | --- |
| 0. Data check | Done: sources chosen, adapter interface, MT4/MT5 importer, sample files |
| 1. Shell | Next |
| 2. Core numbers | |
| 3. Weather map | |
| 4. Gold | |
| 5. Journal and feeds | |
| 6. Polish and release | |

## Run it

```sh
npm install
npm run dev      # data-check page: sample files plus a tester for your own exports
npm test         # unit tests
npm run build    # static site in dist/
```

## Data

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for every source, its
delay and its terms. In short: price history comes from your own MT4/MT5
exports, near-live gold from gold-api.com, daily reference rates from
Frankfurter, and the 10-year yield from the US Treasury. No free near-live
forex feed met the requirements, so intraday forex is file-only.

The shipped sample files are daily reference rates, one value per day. They
are real published rates but they are not intraday market prices.

## Layout

```
src/data/      data adapters: types, instruments, MT4/MT5 importer, file adapter
tests/         unit tests
public/samples sample price files and their manifest
scripts/       sample regeneration
docs/          data sources
```
