# Performance: Mobile Integration Guide

For the mobile developer integrating the **Performance** screen into the member app. An admin uploads the trades they shared in a community, the backend calculates how each one turned out, and the app shows the results. **Paid members** of the community see every trade. **Free members** see only the trades the admin has chosen to show, which turns the screen into a preview of what a subscription gives.

This guide covers the two REST endpoints, the data shapes for the three kinds of board, the month filters, and how free versus paid is decided. Section 6 walks through the screen for each kind of community. It is read-only: members cannot change anything. For the shared basics (login, cookie, response bodies) see [`mobile-community-payment-integration.md`](./mobile-community-payment-integration.md) section 2.

Written against `main` (2026-11-04). If something here disagrees with the backend, the backend wins: please tell us.

## 1. What you are building

There are three kinds of board. A community has at most one, chosen by the admin:

| `kind` | What it shows | Segments |
|---|---|---|
| `intraday` | Trades that open and close the same day, with profit and loss in rupees after charges | `main` |
| `swing` | Trades held for days or weeks, against a target, with hit-rate cards | `main` |
| `investor` | Longer holds, same layout as swing | `investor`, `long_term`, `us_investment` (three tabs) |

| Screen | What it needs |
|---|---|
| **Which communities have a Performance tab** | `GET /boards` |
| **Performance screen** (stat cards, trades table) | `GET /communities/:communityId` |
| **Investor tabs** (Investor / Long Term / US Investment) | the same call with `?segment=` |
| **Month filter** (Intraday) | `?month=2026-08` on the same call |
| **Month-range filter** (Swing and Investor) | `?fromMonth=2026-08&toMonth=2026-09` on the same call |
| **Load more** | `?cursor=` on the same call |

Each community that has a board is its own screen with its own data, so call `GET /communities/:communityId` for the community the member opened. Do not share filter state between communities.

The screen has two parts, and they follow different rules:

- **The summary** (stat cards: capital and P/L, or average holding days and hit-rate cards) covers **every** trade on the board, or only the trades in the **months the member picked** when a filter is given. For the same filter it is the **same for free and paid members**.
- **The trades list** is **everything** for a paid member and **only the allowed trades** for a free member, again narrowed to the picked months. `hiddenCount` tells you how many are held back in those months, so you can show an unlock banner.

The filter narrows the summary and the trades **together**, so the two never disagree:

| Board | What the member sees | Query | What it narrows |
|---|---|---|---|
| `intraday` | One month picker, with "All months" | `month=YYYY-MM` | Summary cards and trades |
| `swing` | A From month and a To month | `fromMonth=YYYY-MM&toMonth=YYYY-MM` | Summary (average holding days, total trades, one hit-rate card for the range) and trades |
| `investor` | Same as swing, on each of the three tabs | `segment=…&fromMonth=…&toMonth=…` | Same as swing, for that tab |

The two forms are interchangeable on any board: `month=2026-08` means the same as `fromMonth=2026-08&toMonth=2026-08`. Use the one that matches your design.

## 2. Conventions

| | |
|---|---|
| REST base | `https://<api-host>/api/v1/mobile/performance` (every path below is relative to this) |
| Auth | The `mobile_session_id` cookie |
| Success body | `{ "success": true, "data": … }` |
| Error body | `{ "success": false, "message": "…", "code": "SOME_CODE" }` (`code` is not always present) |
| Validation error (HTTP 422) | `{ "success": false, "message": "Validation failed", "errors": { "month": ["…"] } }` |
| Ids | UUID strings |
| Dates | `YYYY-MM-DD` for a trade or exit date, `YYYY-MM` for a month. Calendar dates in India time, with no time of day |
| Money | Plain numbers (`-1697`, `368.2`), with up to two decimals for prices. The backend stores **no currency**: show the rupee sign as the design does. The `us_investment` segment is stored and calculated exactly like the others, so tell us if it needs a different currency symbol |
| Percentages | Numbers in percent, to two decimals (`-3.39` means -3.39%) |
| Pagination | Cursor based: pass the `nextCursor` you were given as `cursor`; `null` means no more |

A web (dashboard) login gets 403 `MOBILE_ONLY`; an ended session gets 401 `SESSION_INVALIDATED` (go to login).

## 3. Data shapes

### Board entry

```json
{
  "communityId": "7c3e…",
  "name": "Swing Alpha",
  "slug": "swing-alpha",
  "kind": "swing",
  "segments": ["main"],
  "access": "free"
}
```

`access` is `paid` when the member has an active, unexpired subscription to **that community**, otherwise `free`. It is worked out live on every call, so it is right straight after a purchase or an expiry.

### Summary

The shape depends on `kind`. Check `summary.kind`.

**`intraday`**

```json
{
  "kind": "intraday",
  "capitalDeployed": 50000,
  "grossPnl": 2744,
  "totalCharges": 3920,
  "overallPnl": -1176,
  "totalTrades": 28,
  "profitMakingTrades": 14,
  "lossMakingTrades": 14,
  "profitMakingPct": 50,
  "lossMakingPct": 50
}
```

- `overallPnl` is `grossPnl - totalCharges`. `totalCharges` is a **positive** amount: show it as a cost (for example `-3,920`) if the design wants a minus sign.
- With a month filter, every figure above is for **that month only** (`totalTrades` is the number of trades in the month, the percentages are out of that number). `capitalDeployed` is the same either way. With no trades in the month the counts and amounts are `0`.
- A trade that closed flat counts as neither profit-making nor loss-making, so the two percentages can add up to less than 100.
- The banner under the title is `noteText` at the top level of the response (see section 4), for example "All calculations are done assuming INR 50,000 capital deployed and 5X margin used in each trade."

**`swing` and `investor`**

```json
{
  "kind": "swing",
  "averageHoldingDays": 46.3,
  "totalTrades": 48,
  "periods": [
    { "id": "…", "segment": "main", "name": "Last 10 months", "label": "Last 10 months", "isDefault": true, "fromMonth": "2025-10", "toMonth": "2026-08", "given": 44, "met": 34, "metPct": 77.27 },
    { "id": "…", "segment": "main", "name": "This year", "label": "This year", "isDefault": false, "fromMonth": "2026-01", "toMonth": "2026-08", "given": 32, "met": 23, "metPct": 71.88 }
  ],
  "range": null
}
```

That is the Swing Alpha board as the admin sees it: **three cards in a row**, the same three the dashboard shows:

| Card | From the response |
|---|---|
| **Average Holding Days** (`46.3`) | `summary.averageHoldingDays` (show "-" when it is `null`) |
| **Oct25 to Aug26**: Trades Given 44, Trades Met 34, Met % 77.27% | `summary.periods[0]`: `label`, `given`, `met`, `metPct` |
| **Jan26 to Aug26**: Trades Given 32, Trades Met 23, Met % 71.88% | `summary.periods[1]` |

Draw **one card per entry in `periods`**, in the order given (the admin can add or remove cards at any time, so do not assume two). The two hit-rate cards are part of the app's summary, not an admin-only extra: they come in the same call as the average, for free and paid members alike. If the app only shows Average Holding Days, the cards are being dropped by the screen, not left out by the server.

- Each entry in `periods` is a hit-rate card: **Trades Given** is `given`, **Trades Met** is `met`, **Met %** is `metPct`. `name` (the admin's own title, e.g. "Last 10 months") is ready to display; `label` is the same text, kept for older app builds. `isDefault` marks the card the app should open on: it is always the first entry, so select `periods[0]` by default. Exactly one entry is the default whenever `periods` is not empty. `periods` can be empty, in which case show no cards. These are the cards the admin set up and **they do not change with the month filter**: each always covers its own months.
- `range` is the same card for the months the member picked, worked out on the spot. It is `null` when no month filter was given. With a filter it looks like this:

  ```json
  "range": { "fromMonth": "2026-08", "toMonth": "2026-09", "label": "Aug26 to Sep26", "given": 11, "met": 8, "metPct": 72.73 }
  ```

  `label` is ready to display ("Aug26" when the filter is a single month). `given` is the number of trades dated in those months and `met` how many of them have met their target. With no trades in the months, all three numbers are `0`.
- With a month filter `averageHoldingDays` and `totalTrades` are over the picked months only, and `periods` is unchanged. Show `range` **instead of** the `periods` cards while a filter is on, and the `periods` cards again when it is cleared.
- For an `investor` board the summary is **per segment**: pass `segment` and the numbers cover that segment only.

### Trade row: intraday

```json
{
  "id": "…",
  "tradeDate": "2026-10-01",
  "name": "Ambuja Cement",
  "logoUrl": "https://community.finskool21.in/assets/stock-logos/….png",
  "side": "buy",
  "entryPrice": 368.2,
  "exitPrice": 365.7,
  "plPerShare": -2.5,
  "plPct": -3.39,
  "grossPnl": -1697,
  "charges": 140,
  "netPnl": -1837
}
```

- `logoUrl`: see [Stock logo](#stock-logo) below.
- `side` is `buy` or `sell`: the **Type** column.
- `plPerShare` is the **P/L** column, `plPct` the **P/L %** column, `grossPnl` the **P&L** column, `charges` the **Charges** column (show as `-140`; it is that trade's own charges, which differ from trade to trade, or the board's default when the admin gave none, so never assume it is the same on every row) and `netPnl` the **Net P&L** column. Colour positive green and negative red.

### Trade row: swing and investor

```json
{
  "id": "…",
  "tradeDate": "2026-08-12",
  "name": "BLS International",
  "symbol": "BLS",
  "logoUrl": null,
  "entryPrice": 262,
  "cmp": 209.98,
  "returnPct": -19.85,
  "status": "target_met",
  "targetPct": 5,
  "targetPrice": 275.1,
  "analysis": "5% booked",
  "exitDate": "2026-08-14",
  "holdingDays": 2
}
```

| Column | Field | Notes |
|---|---|---|
| Trade Name | `name` | Draw the stock's logo beside it: see [Stock logo](#stock-logo) |
| NSE Code | `symbol` | |
| Entry | `entryPrice` | |
| CMP | `cmp` | Current market price **as of the admin's last upload**, not live. `null` if the admin gave none |
| Returns | `status`, `returnPct` | When `status` is `target_met`, show the **Target Met** badge and ignore `returnPct`. When `open`, show `returnPct` (green or red); `null` means show a dash |
| Target | `targetPct` | |
| Target Price | `targetPrice` | |
| Analysis | `analysis` | Free text from the admin: `HOLD`, `5% booked`, `Can Avg at CMP`. `null` means blank. Treat unknown text as plain |
| Exit Date | `exitDate` | `null` means the trade is still open: show **Open** |
| Holding Days | `holdingDays` | Calendar days from `tradeDate` to `exitDate`. `null` while open: show a dash |

A trade has met its target exactly when it has an `exitDate`. `status` is never derived from `cmp`: a trade can be `target_met` with a `cmp` below its entry.

### Stock logo

Every row (intraday, swing and investor) carries `logoUrl`: the stock's logo, taken from our stocks table. **Draw that image in place of the initials.** When `logoUrl` is `null`, or the image fails to load, fall back to the initials as before.

- `logoUrl` is a ready-to-use absolute URL. Load it as it is, with no auth header and no changes.
- It is `null` when the stock is not in our table or has no logo yet. That is normal, not an error: some rows will always show initials.
- Swing and investor rows are matched on `symbol` (the NSE code), ignoring case and spaces. Intraday rows have only a `name`, so the match tries the name as a code (`TATASTEEL`) and then as the stock's name (`Tata Steel Ltd`), ignoring case. An intraday name that is spelled differently from our stock list shows initials.
- A logo added to the stocks table later appears on the next load of the list. Cache the image by URL, not the row.
- Same footprint either way: a round avatar, the logo scaled to fit (`contain`) on a white background, so a wide logo is not cropped.

Rows carry no serial number, but the list is in S.N. order, the same as the admin screen (oldest trade first, S.N. 1, 2, 3 …). Number them in the app if the design shows S.N.; a free member's list skips the hidden trades, so count from the first row you receive only if you do not need the admin's numbers.

## 4. REST endpoints

### `GET /boards`: communities with a Performance screen

No query. Returns:

```json
{ "boards": [ { "communityId": "…", "name": "Intraday Edge", "slug": "intraday-edge", "kind": "intraday", "segments": ["main"], "access": "paid" } ] }
```

Every community that has a board is listed, whether or not the member is subscribed, so a free member sees the tab and can open the preview. Communities with no board are not listed. Oldest board first.

| Error | When |
|---|---|
| 401 `SESSION_INVALIDATED` | The session ended |
| 403 `MOBILE_ONLY` | A web login called this |

### `GET /communities/:communityId`: a board's summary and trades

Query, all optional:

| Param | Meaning |
|---|---|
| `segment` | `investor`, `long_term` or `us_investment` on an `investor` board. Leave it out on `intraday` and `swing` (it is `main`). Leaving it out on an `investor` board gives `investor` |
| `month` | `YYYY-MM`: only that month. Narrows `summary`, `hiddenCount` and `items` together. Not together with `fromMonth` / `toMonth` |
| `fromMonth` | `YYYY-MM`: first month of a run, included. Needs `toMonth` |
| `toMonth` | `YYYY-MM`: last month of a run, included. Needs `fromMonth`, and must not be before it |
| `cursor` | The `nextCursor` of the previous page |
| `limit` | 1 to 50, default 20 |

Leave all three month params out for "all months". `fromMonth` and `toMonth` are inclusive and may span a year end (`2025-11` to `2026-02`). Months with no trades are fine: you get an empty list and zeroed summary, not an error. Keep the same `segment` and month params on every page of a list.

Returns:

```json
{
  "communityId": "7c3e…",
  "communityName": "Swing Alpha",
  "kind": "swing",
  "access": "free",
  "segment": "main",
  "segments": ["main"],
  "filter": { "fromMonth": "2026-08", "toMonth": "2026-09" },
  "months": ["2026-10", "2026-09", "2026-08", "2026-07"],
  "summary": { "kind": "swing", "averageHoldingDays": 12.4, "totalTrades": 11, "periods": [], "range": { "fromMonth": "2026-08", "toMonth": "2026-09", "label": "Aug26 to Sep26", "given": 11, "met": 8, "metPct": 72.73 } },
  "noteText": null,
  "hiddenCount": 7,
  "items": [ { "id": "…", "tradeDate": "2026-09-29", "name": "BLS International", "symbol": "BLS" } ],
  "nextCursor": "MjAyNi0wOS0yOVQ…"
}
```

- `access` is `free` or `paid`, as for the board entry.
- `filter` echoes the months you asked for, or is `null` for "all months". A `month=` request comes back as `fromMonth` and `toMonth` with the same value.
- `months` lists every month that has at least one trade on the segment, newest first, **whatever the filter and whatever the member's access**. Build the month pickers from it (a month with no trades is never offered). It is per segment, so on an investor board it changes with the tab.
- `summary`: see section 3. It covers the picked months, or every trade when there is no filter.
- `noteText` is the banner for `intraday` boards, and `null` for the others. It does not change with the filter.
- `hiddenCount` is the number of trades in the picked months (or on the whole segment, with no filter) that this member **cannot** see. It is `null` for a paid member. Use it for a line such as "7 more trades for subscribers" with a button to the plans screen.
- `items` is in S.N. order (oldest trade first), the same order as the admin list. A free member's list contains only the allowed trades, so it can be short or empty.
- `nextCursor` is `null` on the last page.

| Error | When |
|---|---|
| 400 `INVALID_SEGMENT` | `segment` is not one of this board's segments (for example `long_term` on a swing board) |
| 400 `INVALID_CURSOR` | The cursor was not one we gave you. Drop it and reload from the first page |
| 400 | `communityId` is not a UUID |
| 404 `PERFORMANCE_BOARD_NOT_FOUND` | The community has no board (or was removed) |
| 422 | `month`, `fromMonth` or `toMonth` is not `YYYY-MM`; `month` is sent together with `fromMonth` / `toMonth`; only one of `fromMonth` / `toMonth` is sent; `toMonth` is before `fromMonth`; or `limit` is outside 1 to 50 |

A 422 names the field: `{ "errors": { "toMonth": ["toMonth cannot be before fromMonth"] } }`. These are mistakes the UI can prevent (offer only months from `months`, keep To on or after From, send both ends or neither), so you should not see them in normal use.

## 5. Rules the backend applies (so you can word your UI)

- **Paid means a live subscription to this community.** An active, unexpired subscription to **another** community does not unlock this one, and a subscription that has run out is free from the next call, even before the nightly job marks it inactive. Do not decide this in the app from your cached list: use `access`.
- **Free is not an error.** Any signed-in member can open any board. A member with no subscription gets the preview, never a 403.
- **What a free member sees is the admin's choice**, per trade, plus two board-wide limits ("hide trades newer than N days", "show at most M trades"). The app does not receive those numbers and does not need them: render `items`, and use `hiddenCount` for the unlock banner. The preview can therefore change from one visit to the next as the admin edits it.
- **The summary is not filtered by access.** A free member sees the same hit-rate cards and totals as a paid one, even though their list is short. Only the month filter changes it, and it changes it the same way for both.
- **The free limits are not per month.** "Show at most M trades" counts over the whole board, newest first. A free member who picks an old month can therefore see an empty list with a `hiddenCount` above 0. That is correct: show the unlock banner.
- **Numbers are calculated by the backend** from what the admin uploaded. Do not recompute them. Rounding is already applied.
- **CMP is only as fresh as the last upload.** Returns on open trades move when the admin re-uploads, not with the market.
- Admins who manage the community and are signed in to the app are treated as paid.

## 6. The screen for each kind of community

`GET /boards` tells you the `kind` of each community's board. The three screens share the same call, but the cards, the table and the filter differ. In every case a filter change is a **new request that replaces the whole screen** (cards, list, banner count): do not patch the old data, and drop any `cursor` you were holding.

### Intraday community (`kind: "intraday"`)

```
 Intraday Edge
 ┌──────────────────────────────────────────────┐
 │ All calculations are done assuming INR …     │   noteText
 ├──────────────────────────────────────────────┤
 │ Capital   Overall P&L   Gross P&L   Charges  │   summary (for the month picked)
 │ Trades    Profit-making %   Loss-making %    │
 ├──────────────────────────────────────────────┤
 │ Month: [ All months ▾ ]                      │   filter
 ├──────────────────────────────────────────────┤
 │ Date | Stock | Type | Entry | Exit | P/L | …  │   items
 └──────────────────────────────────────────────┘
```

1. **Open.** `GET /communities/:id`. Fill the month dropdown with **All months** plus every entry of `months` (format `2026-08` as "August 2026" in the app).
2. **Pick a month.** `GET /communities/:id?month=2026-08`. Redraw the cards from `summary` and the table from `items`: the figures are for August only.
3. **Back to All months.** Call again with no month param.

Cards: Capital Deployed `capitalDeployed`, Overall P&L `overallPnl`, Gross P&L `grossPnl`, Charges `totalCharges`, Total Trades `totalTrades`, Profit-making `profitMakingTrades` / `profitMakingPct`, Loss-making `lossMakingTrades` / `lossMakingPct`. Table columns are in section 3. The banner `noteText` is the same for every month.

### Swing community (`kind: "swing"`)

```
 Swing Alpha
 ┌──────────────────────────────────────────────┐
 │ Avg holding days   Total trades              │   summary (for the months picked)
 │ ┌─ Aug26 to Sep26 ──────────────┐            │   range card, or the periods cards
 │ │ Given 11   Met 8   Met % 72.73│            │   when no filter is on
 │ └───────────────────────────────┘            │
 ├──────────────────────────────────────────────┤
 │ From: [ Aug 2026 ▾ ]  To: [ Sep 2026 ▾ ]  ✕  │   filter
 ├──────────────────────────────────────────────┤
 │ Trade | NSE | Entry | CMP | Returns | …       │   items, every trade in those months
 └──────────────────────────────────────────────┘
```

1. **Open.** `GET /communities/:id`. Draw the `periods` cards (if any), average holding days and total trades. Fill the From and To pickers from `months`.
2. **Pick a range.** Once the member has chosen **both** From and To, call `GET /communities/:id?fromMonth=2026-08&toMonth=2026-09`. Then:
   - show the hit-rate card from `summary.range` (Trades Given `given`, Trades Met `met`, Met % `metPct`) instead of the `periods` cards;
   - show `summary.averageHoldingDays` and `summary.totalTrades`, which are now for those months;
   - show `items`: **every trade dated in any of those months** (for a paid member), in S.N. order, paged with `nextCursor`.
3. **Clear the filter** (the ✕). Call with no month params: the `periods` cards come back and the list is every month again.

Picker rules: do not call until both ends are set; do not let To be earlier than From (disable those months, or move To up to From); a single month is just From = To. If the member only wants one month you may send `month=` instead.

### Investor community (`kind: "investor"`)

The same screen as swing, drawn three times, one for each tab: Investor (`segment=investor`), Long Term (`long_term`) and US Investment (`us_investment`). Everything is per tab: summary, cards, `months`, `hiddenCount` and trades.

- Open on the first tab with `?segment=investor` (leaving `segment` out gives the same).
- With a range on, a tab switch is `?segment=long_term&fromMonth=2026-08&toMonth=2026-09`. Keeping the member's range across tabs is fine: a tab with no trades in it simply returns an empty list and zeroed numbers. If you would rather reset the filter on a tab change, drop the month params.
- `months` differs between tabs, so rebuild the pickers on each tab change.

### Free members, on every kind

The filter works the same for a free member and the summary is identical to a paid member's for the same months. Only `items` is shorter. With `hiddenCount` above 0 show "N more trades for subscribers" under the list (see section 7).

## 7. Flows, step by step

**Open the Performance tab.** Call `GET /boards` once when the member opens the community area (or the app starts) and keep the result. Show the tab for a community only if it appears in the list. Use `kind` to pick the layout and `segments` to decide whether to draw the three investor tabs.

**Open a board.** Call `GET /communities/:id` (no query for `intraday` and `swing`; `?segment=investor` for the first investor tab). Draw the stat cards from `summary`, the banner from `noteText`, the table from `items`.

**Switch investor tab.** Call again with `?segment=long_term` or `us_investment`. The summary, hit-rate cards, trades and `hiddenCount` are all per segment, so replace everything on the screen.

**Month filter.** Offer the months in `months`. Call with `?month=2026-10` (Intraday) or `?fromMonth=2026-08&toMonth=2026-09` (Swing, Investor). The summary **does** change with the filter: redraw the stat cards from the filtered response. To remove the filter, call again without the month params.

**Load more.** When `nextCursor` is not `null`, show a loader at the end of the list and call again with `cursor=<nextCursor>` (and the same `segment` and month params). Append the items. A free member usually has a short list that ends on the first page. Changing the filter starts again from the first page.

**Free member banner.** When `access` is `free` and `hiddenCount` is more than 0, show a line such as "N more trades for subscribers" with a button that opens the community plans screen (`GET /api/v1/mobile/communities`). When `hiddenCount` is 0, show nothing.

**After a purchase.** Call the board again: `access` flips to `paid` and `items` fills up. Nothing needs refreshing on login.

## 8. Errors at a glance

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `SESSION_INVALIDATED` | 401 | The session ended | Go to login |
| `MOBILE_ONLY` | 403 | A dashboard login called a mobile endpoint | Should not happen in the app |
| `INVALID_SEGMENT` | 400 | Segment does not belong to the board | Use a segment from `segments` |
| `INVALID_CURSOR` | 400 | Unknown or damaged cursor | Reload from the first page |
| `PERFORMANCE_BOARD_NOT_FOUND` | 404 | No Performance board for this community | Hide the tab |
| (none) | 422 | Bad `month`, `fromMonth`, `toMonth` or `limit`, or a month filter that does not make sense (both forms at once, one end missing, To before From). The body names the field | Fix the request |

## 9. Limits

| | |
|---|---|
| Page size | 1 to 50 trades per call, default 20 |
| Segments | Only `investor` boards have more than one |
| Month filter | One month, or a run of whole months, both ends included. No limit on the length of the run |
| Cache | Nothing is cached server-side for a member: each call reads the current state |

## 10. Not available yet

- **Live prices.** CMP and the returns that depend on it are as of the admin's last upload.
- **Push notifications** when the admin adds trades or closes one.
- **A single-trade endpoint.** Every row you need is in the list.
- **Other sort orders.** The list is in S.N. order (oldest first) only; there is no `order` parameter.
- **Chart data.** Only the numbers above are provided.

## 11. Test checklist

1. As a **free member** (subscribed only to the free community), call `GET /boards`: every board is listed with `access: "free"`.
2. Open a board as that member: `access` is `free`, `hiddenCount` is a number, and `items` has fewer rows than `summary.totalTrades`.
3. Subscribe the member to the community (or use a paid test member): `access` is `paid`, `hiddenCount` is `null`, and `items` has every trade.
4. The **summary is identical** in the free and paid responses.
5. Let a subscription expire (`validUntil` in the past): the next call returns `access: "free"` without logging in again.
6. A paid subscription to a **different** community leaves this board `free`.
7. On an `investor` board, open each segment: summary, trades and `hiddenCount` change with the segment. `?segment=main` returns 400 `INVALID_SEGMENT`.
8. `?segment=long_term` on a swing board returns 400 `INVALID_SEGMENT`.
9. Page through a long list with `limit=5`: no trade appears twice, and the last page has `nextCursor: null`.
10. **Intraday month filter.** `?month=2026-08` returns only August's trades, and `summary.totalTrades`, `grossPnl`, `totalCharges` and `overallPnl` equal the sum over exactly those rows. With no month, the summary covers every trade. `filter` is `{ fromMonth: "2026-08", toMonth: "2026-08" }`, then `null` again without the param.
11. **Swing range filter.** `?fromMonth=2026-08&toMonth=2026-09` returns only trades dated in August or September (check the first and last row). `summary.range.given` equals `summary.totalTrades`, and `range.met` is the number of those rows with `status: "target_met"`. The `periods` cards are the same as in an unfiltered call. `summary.range` is `null` when no month param is sent.
12. A range spanning a year end (`fromMonth=2025-11&toMonth=2026-02`) includes both ends and the months between.
13. Months with no trades (for example `fromMonth=2020-01&toMonth=2020-02`) return 200, `items: []`, `nextCursor: null` and zeroed numbers (`averageHoldingDays: null` on swing).
14. **Free member + filter.** The `summary` equals a paid member's for the same months; `items` is shorter; `hiddenCount` counts only the hidden trades inside those months and is `null` for a paid member.
15. Page through a range with `limit=2`: only trades from the range appear, none twice, and the last page has `nextCursor: null`.
16. `months` lists each month with trades, newest first, and does not change when you add a month filter.
17. **Bad filters** return 422 with the field named: `month` together with `fromMonth`; `fromMonth` alone; `toMonth` alone; `fromMonth=2026-09&toMonth=2026-08`; `fromMonth=2026-8`.
18. On an `investor` board a range applies per tab: the same `fromMonth` / `toMonth` with `segment=investor` and `segment=long_term` give different summaries and `months`.
19. `?cursor=garbage` returns 400 `INVALID_CURSOR`.
20. A community with no board returns 404 `PERFORMANCE_BOARD_NOT_FOUND` and does not appear in `GET /boards`.
21. A swing trade with an `exitDate` shows `status: "target_met"` and a holding-days number, even when `cmp` is below `entryPrice`. An open trade has `exitDate: null` and `holdingDays: null`.
22. On an intraday board the figures match the admin screen: check one buy and one sell row against `plPerShare`, `plPct`, `grossPnl`, `charges` and `netPnl`.
23. A web login on either endpoint returns 403 `MOBILE_ONLY`, and no cookie returns 401.
24. A trade for a stock that has a logo in our stocks table has a `logoUrl` that loads. A trade for a stock with no logo, or one not in the table, has `logoUrl: null` and shows initials. Break the URL on purpose: the row shows initials rather than a broken image.
