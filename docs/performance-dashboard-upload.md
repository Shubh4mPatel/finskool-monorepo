# Uploading the three community dashboards (Intraday, Alpha, Investor)

The admin Performance page reads the same Google Sheets exports the team keeps. This page says which tab and
board each file goes to, and what the system does with them.

| File | Board kind | Where to upload | Tab read |
|---|---|---|---|
| `Intraday_Dashboard.xlsx` | Intraday | the Intraday community, segment "main" | `Intraday` (the hidden `Sheet2` is never read) |
| `Alpha_Dashboard.xlsx` | Swing | the Alpha community, segment "main" | `Alpha` |
| `Investor_Dashboard.xlsx` | Investor | the Investor community, **once per segment** | `Investor` for the Investor tab, `Long Term` for Long Term, `US Investment` for US |

For the investor file, open each segment tab on the board and upload the same workbook; the tab with the matching
name is read.

## What the reader handles

- Header row below the title block (row 6 in these files); the title, the note and the summary block beside the table are ignored.
- Dates as real dates or as text (`11 Sept 2024`).
- `Target` stored as a percentage (`0.05` for 5%): read as 5. A column already in percent (5, 10) is left alone.
- `Exit Date` holding `Open` (or Hold, `-`) means the trade is still running.
- Columns the system calculates (Returns, Holding Days, Target Price, P/L, Net P&L, S.N., Month) are ignored.
- Long Term and US Investment: the `Theme / Sector / Type` column (called `Theme` on the US sheet) is read and kept per company. A blank cell leaves a saved theme alone. The Investor segment has no such column.
- Intraday: a `Charges` column is read, because charges differ from trade to trade. A blank cell means the trade uses the board's default charges per trade (Settings), and a cell that already carries a minus sign (`-₹140.00`) is read as the same amount. Uploading again with a changed figure updates the trade; a blank cell leaves the stored figure alone.
- Uploading again updates by date and code (intraday: date, stock, side and entry price), so adding an exit date later works.

## Check against the sheets (the three files provided on 2026-11-04)

| Check | Result |
|---|---|
| Alpha: 48 trades, 37 with an exit date, average holding days 49 | Same in the system |
| Alpha hit-rate cards: Oct25 to Aug26 = 44 given / 36 met; Jan26 to Aug26 = 32 / 25 | Same in the system |
| Investor: 57 trades, 32 met, average holding days 135.1 | Same in the system |
| Investor hit-rate cards: Jan26 to Mar26 = 6 / 4; Jan26 to Aug26 = 24 / 12 | Same in the system |
| Long Term (25 trades) and US Investment (2 trades) | All rows import |
| Intraday: 28 trades, charges 28 x 140 = 3,920, capital 50,000 at 5x | Same, **except the gross P&L** (below) |

### Intraday: four Sell rows disagree with the sheet

The system prices a Sell as entry minus exit (a short gains when the price falls). In the sheet, 16 of the 20 Sell
rows do that, but four use exit minus entry like a Buy:

| Sheet row | Trade | Sheet P&L | System P&L |
|---|---|---|---|
| 8 | Paradeep Phosphate, Sell 156.88 to 158.17 | +2,056 | -2,056 |
| 11 | Netweb Tech, Sell 5090 to 5086 | -196 | +196 |
| 14 | LTM, Sell 4493.40 to 4532.20 | +2,159 | -2,159 |
| 16 | Bank of Maharastra, Sell 81.88 to 82.50 | +1,893 | -1,893 |

Totals: the sheet shows gross +2,744 and overall -1,176; the system shows gross -9,078 and overall -12,998. Treating
those four rows the way the sheet does gives gross +2,746, so they are the whole difference. Either the Entry and Exit
cells of those four rows are swapped in the sheet, or their formulas are wrong. Fix the sheet before the first upload,
or the community will see the lower number.

### Other things noticed in the data (not changed)

- Alpha row 52 (PNB) says 34 holding days; exit date minus trade date is 33.
- `Kotak` is the NSE code on Alpha row 54 (the NSE code is `KOTAKBANK`); `Bank of Maharastra` and `Eli Lily` are spelled that way in the names.
- Alpha and Investor `Trades Given` / `Trades Met` in the sheet are typed numbers, not formulas; the system counts them from the trades.
- The sheet's "Profit Making Trades" is a share of net P&L; the system counts gross P&L (before charges). They agree on these files.
