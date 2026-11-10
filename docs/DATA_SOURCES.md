# Data sources

Phase 0 findings. Every source below was called and its own documentation
read on **10 November 2026**. "Browser-callable" means the response carried
`Access-Control-Allow-Origin: *` when requested with a foreign `Origin`
header, so a static page on GitHub Pages can fetch it with no server.

The app is for market context only. It is not financial advice.

## Summary

| Need | Decision for version 1 | Freshness shown in the app |
| --- | --- | --- |
| Price history, all instruments | File import (MT4/MT5 exports). Always works. | Age of the last bar in the file |
| Gold, near-live | gold-api.com spot price | About 30 seconds |
| Forex, near-live | **No suitable free feed found.** File import only. | n/a |
| Forex and gold, daily | Frankfurter reference rates | Daily, labelled as reference rates |
| US 10-year yield | US Treasury daily par yield curve | Daily |
| Risk mood | Not settled. Load from a file. | Age of the file |
| Calendar | Left out of version 1 | n/a |
| News | Left out of version 1 | n/a |

## Chosen sources

### gold-api.com: near-live gold

- Endpoint: `https://api.gold-api.com/price/XAU`. Returns a spot price in
  USD per troy ounce and an `updatedAt` UTC time.
- Browser-callable: yes. No key for this endpoint.
- Limits: prices update every 30 seconds; the docs ask clients to cache for
  30 seconds and not to send several requests per second. Their terms allow
  banning an IP that does.
- Terms: "Commercial use of the API is always permitted, including use in
  web applications". Data is provided as is, with no accuracy guarantee.
- Covers gold, silver, platinum, palladium, copper, bitcoin and ether.
  **No forex.**
- Gives one quote, not candles. Its history and OHLC endpoints need an API
  key (free plan: 10 requests an hour; minute and hour bars are paid) and
  their docs say never to put the key in frontend code, so the app does not
  use them.
- Use in the app: a live price line and age stamp for XAU/USD. Candles
  still come from files.

### Frankfurter: daily forex and gold reference rates

- Endpoint: `https://api.frankfurter.dev/v2/rates`. Blends rates published
  by central banks and official sources. Covers all eight majors and XAU.
- Browser-callable: yes. No key. "No quotas"; requests are rate-limited
  only to prevent abuse. Responses are cached for up to a day.
- Terms: the project is MIT licensed. Its FAQ says blended rates are "free
  to use" commercially and that storing daily observations is "encouraged".
  Rates fetched for one named provider stay under that provider's terms, so
  the app uses the blended feed only.
- Limits that matter here: **one value per day, not a market price.** The
  site says these are "reference rates, not live market quotes" and that it
  "isn't built for live trading". There is no open, high or low. On the day
  of the check its blended gold rate was 4098.59 while the gold-api.com
  spot price was 4077.70.
- Use in the app: the shipped sample files, and an optional daily fallback
  for the strength board and gold drivers when no file is loaded. Always
  labelled as daily reference rates. Volatility and session panels cannot
  use it because it has no daily range.

### US Treasury: 10-year yield

- Endpoint: the daily par yield curve CSV on `home.treasury.gov`
  (`.../daily-treasury-rates.csv/<year>/all?type=daily_treasury_yield_curve...&_format=csv`).
  The "10 Yr" column is the driver.
- Browser-callable: yes. No key. Official US government publication.
- One value per business day, published after the US close.
- No usage limits are documented; the app fetches it once per session.

## Checked and not used

### Twelve Data (forex candles)

Technically the best fit: browser-callable, and EUR/USD hourly candles came
back on the public demo key. Not used because of its own published terms:

- The free Basic plan is "internal non-display usage only", 8 requests a
  minute and 800 a day. Showing prices on a public demo is display.
- XAU/USD returned an error on the demo key. Their pricing lists
  commodities from the Grow plan (USD 29 a month) upward.
- It needs an API key, and a static site cannot keep a key secret.

It could be added later as a bring-your-own-key adapter for private use on
a paid individual plan. That is a scope decision, not part of version 1.

### FRED (10-year yield)

`fredgraph.csv?id=DGS10` returns the data without a key but sends no CORS
header, so a browser cannot read it. Treasury publishes the same figure and
is browser-callable.

### Cboe VIX history (risk mood)

The published file redirects to `cdn-api.cboe.com`, which this session could
not reach, so neither browser access nor terms were verified. Until that is
done, a risk-mood series is loaded from a file, as the spec allows.

### Forex Factory weekly calendar export

`ff_calendar_thisweek.json` is reachable and current but sends no CORS
header, so a static page cannot read it. Its terms page sits behind a bot
check and could not be read. Not usable without a server.

### FXStreet RSS (news)

Returned a bot challenge (HTTP 403) instead of the feed. Not usable.

No free calendar or headline source that a browser can call directly was
found, so the Calendar and News panels are left out of version 1, as
section 7 of the spec provides.

### Intraday sample data

No source of intraday candles with a clear right to republish was found.
HistData.com offers free one-minute downloads but its About and FAQ pages
state no licence. Nothing on Dukascopy's historical data page grants
redistribution. Neither is shipped.

## Sample files

`public/samples/prices/` holds one daily file for XAU/USD and each of the
28 pairs, 3 November 2025 to 9 November 2026, in the MT5 daily export
layout. They come from Frankfurter's blended feed and can be regenerated
with `npm run samples:fetch`.

Each row is one published rate. Open, high, low and close are the same
number, tick volume is zero, and weekends are omitted. Nothing is
interpolated. They are enough to exercise import, daily strength,
correlation and gold-driver maths. They are **not** enough for intraday
charts, volatility or the session clock, which need real candles from an
MT4/MT5 export.

## MetaTrader export layouts

The importer (`src/data/mtCsv.ts`) reads these price layouts and detects
which one it has been given:

| Layout | Separator | Header | Example row |
| --- | --- | --- | --- |
| MT5 "Export Bars" | tab | `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>` (no `<TIME>` on daily) | `2026.11.09 13:00:00 4081.32 ...` |
| MT4 History Center | comma | none | `2026.11.09,13:00,4081.32,...` |
| Generic | comma, semicolon or tab | named columns, or one ISO date-time column | `2026-11-09T13:00:00Z,4081.32,...` |

It also accepts UTF-16 files, decimal commas in semicolon files, and broker
symbol suffixes such as `EURUSD.m`. Rows it cannot trust are skipped and
listed; they are never repaired.

**Still to confirm with a real export.** These layouts are the platforms'
standard output, but no file from the actual broker has been tested yet.
The data-check page (`npm run dev`) shows what the importer makes of a file.

Two things a file cannot tell the importer:

- **Server time zone.** MetaTrader writes broker server time. The importer
  takes an offset from UTC as a setting. Many brokers move between UTC+2
  and UTC+3 with daylight saving, so a single fixed offset is wrong for
  half the year; phase 1 needs a time-zone setting, not just an offset.
- **Trade history.** Journal import is phase 5. MT4 and MT5 normally save
  account history as an HTML or spreadsheet report, not CSV, so the journal
  parser should be written against a real export.

## Display time zone

Local time by default with a setting to change it, as proposed in the spec.
All times are stored as UTC and converted only for display.
