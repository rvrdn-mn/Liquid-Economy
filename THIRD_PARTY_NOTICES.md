# Third-party notices

Liquid Markets Desk itself is under the MIT licence (see `LICENSE`). The
licences of everything it is built with were checked before that choice:
Lightweight Charts and TypeScript are Apache 2.0; Vite and Vitest are MIT;
world-atlas and topojson-client are ISC. All are compatible with MIT.

## TradingView Lightweight Charts

Used for the chart panel. Licensed under the Apache License, Version 2.0.

TradingView Lightweight Charts™
Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

The library's licence asks for this attribution notice and a link to
https://www.tradingview.com/ on a page available to users. The app keeps the
library's attribution logo, which links there, switched on in every chart.

Licence text: https://www.apache.org/licenses/LICENSE-2.0

## Natural Earth map outlines

The weather map's coastlines and country shapes come from Natural Earth
(https://www.naturalearthdata.com/), which is in the public domain. They
were taken from the `world-atlas` package by Mike Bostock (ISC licence) and
reduced by `scripts/build-map.mjs` into `src/panels/weather/mapData.json`.
`world-atlas` and `topojson-client` (ISC licence) are build-time tools and
are not part of the app.

## Data

Data sources, their delay and their terms are listed in
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
