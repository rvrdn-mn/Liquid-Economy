# How the numbers are calculated

Every figure in the app is plain arithmetic on price bars. Each calculation
is a small function in `src/calc/` with its own tests, kept apart from the
code that draws it. Nothing here predicts anything or gives a signal.

Defaults below are starting values. They are stored as settings; the
strength lookback and the correlation window can be changed in their
panels, and a full settings screen comes in phase 6.

## Currency strength (STR)

1. For each of the 28 pairs, take the percentage change over the lookback
   (default 24 hours).
2. For each currency, average the change of the seven pairs it appears in.
   A pair counts as it is when the currency is quoted first (EUR in
   EURUSD) and with its sign flipped when the currency is quoted second
   (USD in EURUSD).
3. Rescale the eight averages so the weakest is 0 and the strongest is 100.

Worked example with three pairs: EURUSD +1%, USDJPY +2%, EURJPY +3%.
EUR averages (+1 +3) / 2 = +2. USD averages (−1 +2) / 2 = +0.5. JPY
averages (−2 −3) / 2 = −2.5. Rescaled: EUR 100, USD 67, JPY 0.

Details:

- A change is measured between finished bars only. The lookback runs back
  from the end of the last finished bar, and uses the last bar finished by
  that earlier moment, so a weekend is stepped over.
- If a pair has no data it is left out of the averages, and the panel says
  which currencies are short of pairs.
- The history line is the same measure repeated at each earlier bar.

## Volatility (VOL)

1. True range of a bar is the largest of: high minus low, the distance
   from the previous close to the high, and from the previous close to the
   low.
2. Average the last 14 true ranges (a plain mean) and divide by the price.
   That is the "now" figure, a percentage.
3. Average that same figure over the last 20 days of bars.
4. Ratio = now ÷ 20-day average. Above 1 means busier than usual for that
   instrument.

Rows marked † have only one value per bar (daily reference rates, or a
cross computed from two dollar pairs). They have no high or low, so their
true range is the move from one close to the next.

## Session profile and clock (SES)

For each hour of the day, the average of (high − low) ÷ price across the
hourly bars of the last 30 days, per instrument. It needs real candles, so
it is empty until an intraday file is imported.

Sessions are each centre's own business hours: Tokyo 09:00 to 18:00,
London 08:00 to 17:00, New York 08:00 to 17:00, Monday to Friday. Their
position on the dial moves with each centre's daylight saving.

## Linked pairs (LINK)

1. For two instruments, take the bars they both have and compute the
   percentage change from each shared bar to the next.
2. Pearson correlation of the last 50 such changes.
3. Flag the pair when the absolute value is above 0.8.

+1 means they moved together, −1 means they moved opposite, 0 means no
linear relationship. If two instruments share fewer bars than the window
needs, the cell shows a dash, not a number.

## Weather map (WX)

The same numbers as the strength board and the volatility panel, regrouped
by currency and drawn as weather.

- **Pressure** is the strength score, 0 to 100. Isobars ring each region,
  H marks a strong currency (60 or more) and L a weak one (40 or less).
- **Wind** is the change in that score over the last 6 bars. Streams flow
  out of currencies losing strength and into those gaining it.
- **Storm** is the average volatility ratio of the currency's seven pairs.
  1.00× is its own usual level. From 1.1× it is "breezy", from 1.4× a
  "storm", from 1.8× a "severe storm" with lightning.

The exact readings are listed under the map. The motion is a stylised
effect; it carries no information beyond those three numbers.

## Replay (RPL)

Replay sets one past moment for every panel. From then on each panel is
given only what was known at that moment:

- Bars built from a finer file (hourly bars from one-minute data, say) end
  with a part-formed bar made only of the minutes that had finished.
- Data with no finer source, such as the daily sample set, shows a bar
  only once that bar has finished.
- Comparisons between instruments use finished bars only.

Each step moves one bar of the selected timeframe. A gold REPLAY marker
stays in the top bar for as long as replay is on.

## Rules that apply to every panel

- **One "as of" time.** Panels that compare instruments stop at the moment
  the first instrument runs out of data, and the footer names it. Otherwise
  a file ending in October set against data ending in November would look
  like a price move.
- **Source and age.** Every footer says where the data came from and how
  old it is.
- **Crosses from the dollar pairs.** With files for the seven dollar pairs
  (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY), the other 21
  pairs are computed: EURGBP = EURUSD ÷ GBPUSD, EURJPY = EURUSD × USDJPY.
  Only the close can be computed this way, so derived pairs are labelled
  and drawn as a line.
- **Bars built from finer files.** A one-minute file is combined into 5
  minute, 15 minute, hourly, 4 hour and daily bars. The trading day starts
  at 17:00 New York by default.

## How the results were checked

- Each function has unit tests with small examples worked by hand.
- On the shipped sample data, the strength scores, volatility ratios and
  correlations were also computed by a separate script reading the CSV
  files directly, and the app's results are tested against those numbers
  (`tests/analysis.test.ts`).
- On real one-minute files for October 2026 (not in the repository), the
  EURUSD–GBPUSD hourly correlation, the EURUSD volatility ratio and the
  EURUSD busiest hours were recomputed the same way and agreed.
- Replay is tested to never change a bar it has already shown and never to
  include anything later than the replay moment.
- Replaying the US jobs report of 2 October 2026 on five-minute bars, the
  dollar's storm reading went from 0.96× at 12:00 UTC to 1.65× at 12:35
  and 2.15× at 13:00.
