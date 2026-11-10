# Data sources

Phase 0 findings. Every source below was called and its own documentation
read on **10 November 2026**, in two rounds. "Browser-callable" means the response carried
`Access-Control-Allow-Origin: *` when requested with a foreign `Origin`
header, so a static page on GitHub Pages can fetch it with no server.

The app is for market context only. It is not financial advice.

## Summary

| Need | Decision for version 1 | Freshness shown in the app |
| --- | --- | --- |
| Price history, all instruments | File import: HistData.com one-minute files, kept private. Also reads MT4/MT5 and TradingView exports. | Age of the last bar in the file |
| Gold, near-live | gold-api.com spot price | About 30 seconds |
| Forex, near-live | **No free feed cleared for a public demo.** File import only. Kraken works technically but needs written consent (see below). | n/a |
| Forex and gold, daily | Frankfurter reference rates | Daily, labelled as reference rates |
| US 10-year yield | US Treasury daily par yield curve | Daily |
| Risk mood | Load from a file. Cboe's VIX file cannot be read by a browser. | Age of the file |
| Calendar | No free source cleared. Open decision. | n/a |
| News | Central-bank headline feeds exist but most need a scheduled copy step. Open decision. | n/a |

## Decisions

Settled with the project owner on 10 November 2026.

- **Imported price files stay private.** They live in the owner's browser
  and are never committed. The public demo shows the daily sample set.
- **Intraday history comes from HistData.com**, downloaded by the owner for
  private use. No broker account is involved. The owner is in India, where
  the Reserve Bank of India's Alert List of unauthorised forex platforms
  names most international MT4/MT5 brokers and MetaTrader itself.
- **Live prices: gold only.** Forex is daily reference rates plus imported
  files. The adapter layer leaves room for a live forex feed later.
- **Risk mood loads from a file.**
- **Calendar is left out of version 1.** No free source is cleared.
- **News: proposed, not yet approved.** A scheduled job would copy
  central-bank headlines into the site, once each bank's reuse terms have
  been read.

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

### Kraken public market data (forex candles)

The closest thing to a free intraday forex feed. `api.kraken.com/0/public/OHLC`
needs no key, is browser-callable, and returned hourly EUR/USD candles that
agree with the other sources. It serves the last 720 candles per request at
5 minute, 15 minute, 1 hour, 4 hour and daily intervals.

Not used, for two reasons:

- **Terms.** Kraken's global terms allow use of its content "only for your
  own benefit", forbid making it "available to any third party", and forbid
  developing "third-party applications that interact with Our Content
  without our prior written consent". A public demo would need Kraken's
  written permission.
- **Coverage.** It lists 12 of the 28 pairs (AUD/JPY, AUD/USD, EUR/AUD,
  EUR/CAD, EUR/CHF, EUR/GBP, EUR/JPY, EUR/USD, GBP/USD, USD/CAD, USD/CHF,
  USD/JPY) and nothing with NZD. Its gold listings are gold-backed tokens,
  not XAU/USD. Prices are trades on Kraken's own exchange, not the
  interbank market.

If Kraken gives consent, an adapter is a small job.

### Cboe VIX history (risk mood)

`cdn-api.cboe.com/.../VIX_History.csv` is reachable and current, but sends
no CORS header, so a browser cannot read it. A risk-mood series is loaded
from a file, as the spec allows. Cboe's terms for copying the file into the
site were not read.

### Forex Factory weekly calendar export

`ff_calendar_thisweek.json` is reachable and current but sends no CORS
header, so a static page cannot read it. Its terms page sits behind a bot
check and could not be read. Not usable without a server.

### FXStreet RSS (news)

Returned a bot challenge (HTTP 403) instead of the feed. Not usable.

### financecalendar.com (calendar)

Needs a paid API key (USD 9.99 a year), which its docs say must stay on a
server, and "sharing data with customers or other third parties requires a
written licence". Not usable in a public static app.

### Central-bank press feeds (news)

Official RSS feeds were reachable for the Federal Reserve, ECB, Bank of
England, Reserve Bank of Australia and Bank of Canada. Only the Bank of
Canada feed is browser-callable. The others would need a scheduled job
(for example a GitHub Action) that copies headline, date and link into the
site. That keeps the app serverless at run time but is a change to the
spec, and each bank's reuse terms still have to be read. The Bank of
Japan, Swiss National Bank and Reserve Bank of New Zealand feeds were not
tested.

No free calendar source cleared for public display was found. Whether to
add the scheduled copy step for news is an open decision.

### Intraday data for the public demo

No source of intraday candles with a clear right to republish was found.
HistData.com offers free one-minute downloads but its About and FAQ pages
state no licence, and nothing on Dukascopy's historical data page grants
redistribution. So no intraday file is shipped in the repository.

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

## Price file layouts

The importer (`src/data/mtCsv.ts`) detects which layout it has been given:

| Layout | Separator | Header | Example row |
| --- | --- | --- | --- |
| HistData.com "MetaTrader" | comma | none | `2026.10.01,00:00,4175.025000,...,0` |
| MT4 History Center | comma | none | `2026.11.09,13:00,4081.32,...` |
| MT5 "Export Bars" | tab | `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>` (no `<TIME>` on daily) | `2026.11.09 13:00:00 4081.32 ...` |
| TradingView chart export | comma | `time,open,high,low,close` | time as ISO text or a unix number |
| Generic | comma, semicolon or tab | named columns | `2026-11-09T13:00:00Z,4081.32,...` |

It also accepts UTF-16 files, decimal commas in semicolon files, and broker
symbol suffixes such as `EURUSD.m`. Rows it cannot trust are skipped and
listed; they are never repaired.

A file of fine bars serves every coarser timeframe. A one-minute file gives
M5, M15, H1, H4 and D1; the bars are built on request and labelled as built.

### HistData.com files: confirmed with a real file

`DAT_MT_XAUUSD_M1_202610.csv` (October 2026 gold, one-minute) was
downloaded for testing and not committed. Result: 29,998 bars, no rows
skipped, 501 hourly bars built. Three things learned from it:

- **Its clock is not the fixed UTC-5 its FAQ describes.** The FAQ says
  "EST without daylight saving". In the file, the US jobs report spike of
  2 October sits at 08:30, which is UTC-4, and the daily market break moves
  by an hour on 26 October, the day after Europe's clocks changed. The
  clock that fits is UTC-4 while Europe is on summer time and UTC-5
  otherwise. The importer's "HistData.com" clock setting does this. With
  it, the month builds into 22 daily bars, one per weekday; with a fixed
  UTC-5 it built 26, with four false Saturday bars.
- **Some minutes are split across two rows** (430 in this file): one full
  row and one flat single-price row, in either order. The importer combines
  rows that share a timestamp, in file order, and reports the count.
- **Volume is always zero.** HistData removes it.

Its daily values agree with the Frankfurter sample for gold once
Frankfurter's lag is allowed for: central banks publish late, so the
blended reference trails the market by about a day.

### Not yet confirmed with a real file

- **MT4/MT5 exports.** The layouts are the platforms' standard output but
  no file from a real terminal has been tested.
- **TradingView exports.** Whether the free plan offers "Export chart
  data" could not be confirmed. If it does, the file should import as is.

### What a file cannot tell the importer

- **Its clock.** Chosen at import in the Files panel: "HistData.com",
  "MetaTrader server" (New York time plus seven hours, the usual broker
  convention, not yet checked against a real broker file), or a fixed
  offset from UTC. A wrong choice shifts every bar by whole hours.
- **Where the trading day starts.** A setting, default 17:00 New York,
  which is the forex convention and avoids a short Sunday bar. It applies
  to four-hour and daily bars built from finer files.

Journal import is phase 5 and should be written against a real trade
history file.

## Display time zone

Local time by default with a setting to change it, as proposed in the spec.
All times are stored as UTC and converted only for display.
