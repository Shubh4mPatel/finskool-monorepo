# Performance: Mobile Integration Guide

For the mobile developer integrating the **Performance** screen into the member app. An admin uploads the trades they shared in a community, the backend calculates how each one turned out, and the app shows the results. **Paid members** of the community see every trade. **Free members** see only the trades the admin has chosen to show, which turns the screen into a preview of what a subscription gives.

This guide covers the two REST endpoints, the data shapes for the three kinds of board, and how free versus paid is decided. It is read-only: members cannot change anything. For the shared basics (login, cookie, response bodies) see [`mobile-community-payment-integration.md`](./mobile-community-payment-integration.md) section 2.

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
| **Month filter**, **load more** | `?month=` and `?cursor=` on the same call |

The screen has two parts, and they follow different rules:

- **The summary** (stat cards: capital and P/L, or average holding days and hit-rate cards) always covers **every** trade on the board, and is the **same for free and paid members**.
- **The trades list** is **everything** for a paid member and **only the allowed trades** for a free member. `hiddenCount` tells you how many are held back, so you can show an unlock banner.

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
- A trade that closed flat counts as neither profit-making nor loss-making, so the two percentages can add up to less than 100.
- The banner under the title is `noteText` at the top level of the response (see section 4), for example "All calculations are done assuming INR 50,000 capital deployed and 5X margin used in each trade."

**`swing` and `investor`**

```json
{
  "kind": "swing",
  "averageHoldingDays": 46.3,
  "totalTrades": 48,
  "periods": [
    { "id": "…", "segment": "main", "fromMonth": "2025-10", "toMonth": "2026-08", "label": "Oct25 to Aug26", "given": 44, "met": 34, "metPct": 77.27 },
    { "id": "…", "segment": "main", "fromMonth": "2026-01", "toMonth": "2026-08", "label": "Jan26 to Aug26", "given": 32, "met": 23, "metPct": 71.88 }
  ]
}
```

That is the Swing Alpha board as the admin sees it: **three cards in a row**, the same three the dashboard shows:

| Card | From the response |
|---|---|
| **Average Holding Days** (`46.3`) | `summary.averageHoldingDays` (show "-" when it is `null`) |
| **Oct25 to Aug26**: Trades Given 44, Trades Met 34, Met % 77.27% | `summary.periods[0]`: `label`, `given`, `met`, `metPct` |
| **Jan26 to Aug26**: Trades Given 32, Trades Met 23, Met % 71.88% | `summary.periods[1]` |

Draw **one card per entry in `periods`**, in the order given (the admin can add or remove cards at any time, so do not assume two). The two hit-rate cards are part of the app's summary, not an admin-only extra: they come in the same call as the average, for free and paid members alike. If the app only shows Average Holding Days, the cards are being dropped by the screen, not left out by the server.

- Each entry in `periods` is a hit-rate card: **Trades Given** is `given`, **Trades Met** is `met`, **Met %** is `metPct`. `label` is ready to display. `periods` can be empty, in which case show no cards.
- For an `investor` board the summary is **per segment**: pass `segment` and the numbers cover that segment only.

### Trade row: intraday

```json
{
  "id": "…",
  "tradeDate": "2026-10-01",
  "name": "Ambuja Cement",
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

- `side` is `buy` or `sell`: the **Type** column.
- `plPerShare` is the **P/L** column, `plPct` the **P/L %** column, `grossPnl` the **P&L** column, `charges` the **Charges** column (show as `-140`) and `netPnl` the **Net P&L** column. Colour positive green and negative red.

### Trade row: swing and investor

```json
{
  "id": "…",
  "tradeDate": "2026-08-12",
  "name": "BLS International",
  "symbol": "BLS",
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
| Trade Name | `name` | |
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

Rows carry no serial number. Number them in the app if the design shows S.N. (the admin screen counts oldest first, the app list is newest first).

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
| `month` | `YYYY-MM`: only trades dated in that month. Does **not** change `summary` or `hiddenCount` |
| `cursor` | The `nextCursor` of the previous page |
| `limit` | 1 to 50, default 20 |

Returns:

```json
{
  "communityId": "7c3e…",
  "communityName": "Swing Alpha",
  "kind": "swing",
  "access": "free",
  "segment": "main",
  "segments": ["main"],
  "summary": { "kind": "swing", "averageHoldingDays": 46.3, "totalTrades": 48, "periods": [] },
  "noteText": null,
  "hiddenCount": 41,
  "items": [ { "id": "…", "tradeDate": "2026-08-12", "name": "BLS International", "symbol": "BLS" } ],
  "nextCursor": "MjAyNi0wOC0xMlQ…"
}
```

- `access` is `free` or `paid`, as for the board entry.
- `summary`: see section 3.
- `noteText` is the banner for `intraday` boards, and `null` for the others.
- `hiddenCount` is the number of trades on the segment that this member **cannot** see, over all months. It is `null` for a paid member. Use it for a line such as "41 more trades for subscribers" with a button to the plans screen.
- `items` is newest first by trade date. A free member's list contains only the allowed trades, so it can be short or empty.
- `nextCursor` is `null` on the last page.

| Error | When |
|---|---|
| 400 `INVALID_SEGMENT` | `segment` is not one of this board's segments (for example `long_term` on a swing board) |
| 400 `INVALID_CURSOR` | The cursor was not one we gave you. Drop it and reload from the first page |
| 400 | `communityId` is not a UUID |
| 404 `PERFORMANCE_BOARD_NOT_FOUND` | The community has no board (or was removed) |
| 422 | `month` is not `YYYY-MM`, or `limit` is outside 1 to 50 |

## 5. Rules the backend applies (so you can word your UI)

- **Paid means a live subscription to this community.** An active, unexpired subscription to **another** community does not unlock this one, and a subscription that has run out is free from the next call, even before the nightly job marks it inactive. Do not decide this in the app from your cached list: use `access`.
- **Free is not an error.** Any signed-in member can open any board. A member with no subscription gets the preview, never a 403.
- **What a free member sees is the admin's choice**, per trade, plus two board-wide limits ("hide trades newer than N days", "show at most M trades"). The app does not receive those numbers and does not need them: render `items`, and use `hiddenCount` for the unlock banner. The preview can therefore change from one visit to the next as the admin edits it.
- **The summary is not filtered.** A free member sees the same hit-rate cards and totals as a paid one, even though their list is short.
- **Numbers are calculated by the backend** from what the admin uploaded. Do not recompute them. Rounding is already applied.
- **CMP is only as fresh as the last upload.** Returns on open trades move when the admin re-uploads, not with the market.
- Admins who manage the community and are signed in to the app are treated as paid.

## 6. Flows, step by step

**Open the Performance tab.** Call `GET /boards` once when the member opens the community area (or the app starts) and keep the result. Show the tab for a community only if it appears in the list. Use `kind` to pick the layout and `segments` to decide whether to draw the three investor tabs.

**Open a board.** Call `GET /communities/:id` (no query for `intraday` and `swing`; `?segment=investor` for the first investor tab). Draw the stat cards from `summary`, the banner from `noteText`, the table from `items`.

**Switch investor tab.** Call again with `?segment=long_term` or `us_investment`. The summary, hit-rate cards, trades and `hiddenCount` are all per segment, so replace everything on the screen.

**Month filter.** Offer months as you like (for example the last 12). Call with `?month=2026-10`. The summary stays the same: do not redraw the stat cards from a month-filtered call, or keep using the first call's summary.

**Load more.** When `nextCursor` is not `null`, show a loader at the end of the list and call again with `cursor=<nextCursor>` (and the same `segment` and `month`). Append the items. A free member usually has a short list that ends on the first page.

**Free member banner.** When `access` is `free` and `hiddenCount` is more than 0, show a line such as "N more trades for subscribers" with a button that opens the community plans screen (`GET /api/v1/mobile/communities`). When `hiddenCount` is 0, show nothing.

**After a purchase.** Call the board again: `access` flips to `paid` and `items` fills up. Nothing needs refreshing on login.

## 7. Errors at a glance

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `SESSION_INVALIDATED` | 401 | The session ended | Go to login |
| `MOBILE_ONLY` | 403 | A dashboard login called a mobile endpoint | Should not happen in the app |
| `INVALID_SEGMENT` | 400 | Segment does not belong to the board | Use a segment from `segments` |
| `INVALID_CURSOR` | 400 | Unknown or damaged cursor | Reload from the first page |
| `PERFORMANCE_BOARD_NOT_FOUND` | 404 | No Performance board for this community | Hide the tab |
| (none) | 422 | Bad `month` or `limit` | Fix the request |

## 8. Limits

| | |
|---|---|
| Page size | 1 to 50 trades per call, default 20 |
| Segments | Only `investor` boards have more than one |
| Cache | Nothing is cached server-side for a member: each call reads the current state |

## 9. Not available yet

- **Live prices.** CMP and the returns that depend on it are as of the admin's last upload.
- **Push notifications** when the admin adds trades or closes one.
- **A single-trade endpoint.** Every row you need is in the list.
- **Other sort orders.** The list is newest first only.
- **Chart data.** Only the numbers above are provided.

## 10. Test checklist

1. As a **free member** (subscribed only to the free community), call `GET /boards`: every board is listed with `access: "free"`.
2. Open a board as that member: `access` is `free`, `hiddenCount` is a number, and `items` has fewer rows than `summary.totalTrades`.
3. Subscribe the member to the community (or use a paid test member): `access` is `paid`, `hiddenCount` is `null`, and `items` has every trade.
4. The **summary is identical** in the free and paid responses.
5. Let a subscription expire (`validUntil` in the past): the next call returns `access: "free"` without logging in again.
6. A paid subscription to a **different** community leaves this board `free`.
7. On an `investor` board, open each segment: summary, trades and `hiddenCount` change with the segment. `?segment=main` returns 400 `INVALID_SEGMENT`.
8. `?segment=long_term` on a swing board returns 400 `INVALID_SEGMENT`.
9. Page through a long list with `limit=5`: no trade appears twice, and the last page has `nextCursor: null`.
10. `?month=2026-10` returns only that month's trades and an unchanged `summary`.
11. `?cursor=garbage` returns 400 `INVALID_CURSOR`.
12. A community with no board returns 404 `PERFORMANCE_BOARD_NOT_FOUND` and does not appear in `GET /boards`.
13. A swing trade with an `exitDate` shows `status: "target_met"` and a holding-days number, even when `cmp` is below `entryPrice`. An open trade has `exitDate: null` and `holdingDays: null`.
14. On an intraday board the figures match the admin screen: check one buy and one sell row against `plPerShare`, `plPct`, `grossPnl`, `charges` and `netPnl`.
15. A web login on either endpoint returns 403 `MOBILE_ONLY`, and no cookie returns 401.
