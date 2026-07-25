# Live index/stock sockets + Stock Recommendations feature

## Context

The ask started as "copy EqLion's live index/stock sockets so admin and user can connect," but investigation showed EqLion's sockets are just two data feeds (broadcast-all indices, per-client-subscribed stock ticks) with no admin/user distinction — both would simply consume the same public feeds. Digging into the cold-start fallback then surfaced that finskool has **no stock-recommendations backend at all** yet (`admin/stock-recommendations` and `(dashboard)/stock-tracker` are empty "Coming Soon" placeholders), so the user asked to build that too: a real admin-managed recommendation table (symbol, entry/SL/target, active flag) with a price-history table and daily cron, mirroring EqLion's 3-tier fallback (Redis → FinEdge API → DB).

Further investigation found `apps/frontend/src/app/(dashboard)/recommendations/page.tsx` — an **already fully-designed mock UI** (stats cards: Total Calls/Active/Avg Return/Win Rate; a searchable/filterable table with company, sector, entry, CMP, target, stop-loss, return%, risk, BUY/HOLD/SELL call badge) currently driven by a hardcoded array. This is the real consumer page for stock recommendations — `stock-tracker` is a separate, still-undefined placeholder ("Stocks from active recommendations will appear here so you can track their performance") that likely means a personal watchlist/portfolio view layered on top of recommendations; it's left out of this plan pending clarification, since guessing its design would be wasted work.

Decisions already confirmed with the user across several rounds:
- Data source: **AngelOne SmartAPI** (same broker as EqLion) — needs `ANGELONE_API_KEY`/`ANGELONE_CLIENT_CODE`/`ANGELONE_PIN`/`ANGELONE_TOTP_SECRET` in `.env`.
- Scope: **indices + stocks only** (2 sockets) — skip EqLion's gainers/losers/raw-market-feed sockets.
- Auth: **fully public/unauthenticated** sockets, matching EqLion exactly (no JWT gate).
- Index list: same six as EqLion (NIFTY 50, BANK NIFTY, NIFTY NEXT 50, FINNIFTY, NIFTY MIDCAP SELECT, SENSEX).
- Cold-start fallback: full 3-tier (Redis cache → FinEdge API, needs `STOCK_API_KEY` → new `StockPriceHistory` table), plus a daily cron that refreshes prices for all active recommendations.
- Recommended-stocks source: a **new admin-managed `StockRecommendation` table** (symbol, entry price, stop-loss, target price, other info, `isActive`) — not derived from post tags, not hardcoded.

## Approach — three independently-buildable/testable phases

### Phase 1 — Data model + admin CRUD (no broker credentials needed, can be done and tested first)

**Prisma** (`apps/backend/prisma/schema.prisma`, new migration):
- `enum StockCallType { buy hold sell }`, `enum StockRiskLevel { low medium high }`
- `model StockRecommendation`: `id, communityId (FK), symbol, exchange, sector, entryPrice, targetPrice, stopLoss, callType, riskLevel, notes?, isActive Boolean @default(true), createdBy (FK User), createdAt, updatedAt, deletedAt?` — indexed on `[communityId, isActive]`.
- `model StockPriceHistory`: `id, symbol, date, price, changePercent, createdAt` — `@@unique([symbol, date])`, this is EqLion's `dailyRatio` equivalent, populated by the Phase 3 cron and read by the Phase 3 fallback resolver.

Follow the **Post** precedent for scoping (confirmed via `posts.service.ts`): community-scoped, gated with the existing `assertCommunityAccess(db, adminId, communityId)` helper (`apps/backend/src/lib/community-access.ts`) on create, and keyed off the resource's own `communityId` on update/delete — not a platform-wide list.

**Backend** — new `apps/backend/src/modules/stock-recommendations/` module, mirroring the `posts` module's file convention (`.dto.ts`, `.validator.ts`, `.service.ts`, `.controller.ts`, `.routes.ts`):
- `POST /api/v1/stock-recommendations` (admin, community-scoped create)
- `PATCH /api/v1/stock-recommendations/:id` (edit fields, toggle `isActive`)
- `DELETE /api/v1/stock-recommendations/:id` (soft delete)
- `GET /api/v1/stock-recommendations` — for **admins**: scoped by their accessible communities (same pattern as `posts.controller.ts`'s `list`, using `getAccessibleCommunityIds`); for **members**: resolved server-side from `req.user.selectedCommunityId`/`communityIds` (same pattern as `posts.controller.ts` lines 61-68) — the frontend never passes `communityId` explicitly, exactly like the existing Feed.
- Mount in `apps/backend/src/app.ts` alongside the other route mounts.

**Frontend**:
- `apps/frontend/src/app/admin/stock-recommendations/page.tsx` — replace the "Coming Soon" placeholder with a real list + create/edit modal, following the CRUD shape already established in `admin/roles-admins/page.tsx` (fetch-on-mount, `api.post`/`api.patch`/`api.delete`, optimistic list update) and `admin/members/page.tsx`'s hand-rolled field-validator pattern (`fieldCls(err)` helper, `touched`/`onBlur`) for the numeric price fields. Extend `apps/frontend/src/components/profile/ToggleSwitch.tsx` (currently display-only, just an `on` prop) with an `onClick`/`onChange` prop so it can drive the `isActive` toggle interactively.
- `apps/frontend/src/app/(dashboard)/recommendations/page.tsx` — replace the hardcoded `recommendations` array with a `GET /api/v1/stock-recommendations` fetch; keep the existing layout/stats/table/filters as-is, compute `return %`/stats client-side from real entry vs. current price. Until Phase 2 lands, "current price" falls back to `entryPrice` (no live/last-known price source exists yet); Phase 2 replaces this with a live tick overlay.

### Phase 2 — Live sockets (needs real AngelOne credentials to produce real ticks; buildable/testable with stubbed credentials in the meantime)

**Backend** — new `apps/backend/src/sockets/` directory, porting EqLion's logic near-verbatim (adjusted for finskool's `env`/`redis`/`logger` modules) but trimmed to only what indices + stocks need (no raw market-feed or gainers/losers modules):
- `sockets/angelone/angelone.types.ts`, `angelone.config.ts`, `angelone.parser.ts` (binary SnapQuote packet decoder), `angelone.client.ts` (SmartAPI login with TOTP via `otplib`, outbound WS via `ws`, auto-reconnect, `tick`/`auth` events) — ports `market-feed/angelone.client.ts` + `.parser.ts` + `.types.ts` + `.config.ts` from EqLion almost as-is.
- `sockets/angelone/market-status.ts` — tick-driven open/closed detector, ports EqLion's `market-feed/market-status.ts` as-is (Redis-backed "opened today" flag).
- `sockets/indices/` (`.types.ts`, `.store.ts`, `.server.ts`, `.module.ts`) — broadcast-all `/ws/indices`, ports EqLion's `indices/*` as-is.
- `sockets/stocks-feed/` (`.types.ts`, `.registry.ts`, `.server.ts`, `.module.ts`) — per-client subscribe/unsubscribe `/ws/stocks`, ports EqLion's `stocks-feed/*` (fallback resolver split into Phase 3 below).
- `apps/backend/src/lib/scrip-master.service.ts` — symbol→AngelOne-token resolver via their public master-scrip JSON, Redis-cached; ports EqLion's `scrip-master.service.ts` as-is.
- `sockets/index.ts` — exports `attachLiveDataSockets(httpServer)`, composes the above (mirrors EqLion's `index.ts` wiring of `angelOne`, `indices`, `stocksFeed`).
- `apps/backend/src/index.ts` — change `app.listen(...)` to `http.createServer(app)` + `server.listen(...)` (needed so Socket servers can attach via the `'upgrade'` event), call `attachLiveDataSockets(server)`, start the AngelOne client, extend graceful shutdown.
- `apps/backend/src/config/env.ts` — add an `angelone: { apiKey, clientCode, pin, totpSecret }` block, same shape as EqLion's `env.ts`.
- New deps in `apps/backend/package.json`: `ws`, `axios`, `otplib`.

**Frontend** — new `apps/frontend/src/store/marketSocket/` (`marketSocketStore.ts`, `hooks.ts` — `useIndices`/`useStockTick`/`useStockTicks`/`useMarketStatus`, `MarketSocketProvider.tsx`, `types.ts`), ported near-verbatim from EqLion (native `WebSocket`, `useSyncExternalStore`-based singleton store, no new state-management dependency). Mount `<MarketSocketProvider>` in `apps/frontend/src/app/layout.tsx` nested inside the existing `ToastProvider`/`ConfirmProvider` (the one layout shared by both `/admin` and `(dashboard)`), so it's available everywhere for free, exactly like EqLion's own design intent. New env var `NEXT_PUBLIC_WS_URL`.
- Update `(dashboard)/recommendations/page.tsx` to overlay live/last-known CMP via `useStockTick(symbol)` per row (same pattern as EqLion's `StocksPanel.tsx`: `ticks[symbol]?.ltp ?? entryPrice` until a tick arrives), making "Last updated: X ago" and CMP genuinely live.

### Phase 3 — Price history + fallback resolver + cron (needs `STOCK_API_KEY` for FinEdge)

- `apps/backend/src/sockets/stocks-feed/stocks-feed.fallback.ts` — 3-tier resolver (Redis cache, TTL~3h → FinEdge quote API → latest `StockPriceHistory` row for that symbol), ported from EqLion's `stocks-feed.fallback.ts` with the DB tier repointed at the new `StockPriceHistory` table instead of EqLion's `dailyRatio`. Wired into the stocks-feed module's subscribe handler exactly as in EqLion (serves an immediate quote to a newly-subscribed client with no live tick yet).
- `apps/backend/src/modules/stock-recommendations/stock-recommendations.cron.ts` — daily `node-cron` job (new dependency), runs after market close, fetches the latest price via the FinEdge API for every `isActive` `StockRecommendation` symbol, upserts into `StockPriceHistory`. Started from `index.ts` (runs in the main backend process — no separate worker needed, matching how `market-status`'s own watchdog timer already runs in-process).
- `apps/backend/src/config/env.ts` — add `stockApiKey`.

### Not in scope
- `stock-tracker` page — left as-is; its relationship to `recommendations` (a personal watchlist? a subset view?) needs its own clarification before building.
- EqLion's gainers/losers and raw market-feed sockets.
- Any auth/JWT gate on the two sockets (matches EqLion, per earlier decision).
- Server-side pagination for the recommendations list (datasets are expected to be small per-community; can be added later if needed).

## Verification
1. **Phase 1**: `npx tsc --noEmit` in `apps/backend`/`apps/frontend`. Log in as an admin, create/edit/deactivate a stock recommendation scoped to a community; confirm it appears (and disappears when deactivated, if the list filters by active) on the `(dashboard)/recommendations` page for a member of that community, and is invisible to a member of a different community.
2. **Phase 2** (once real AngelOne credentials are in `.env`): start the backend, confirm logs show AngelOne login success and indices/stocks WebSocket servers listening; open the frontend, confirm `(dashboard)/recommendations` CMP values update live during market hours, and `market_status` correctly reflects open/closed.
3. **Phase 3** (once `STOCK_API_KEY` is set): manually trigger the cron function once, confirm `StockPriceHistory` rows are written for active recommendations; subscribe to a symbol with no live tick yet (e.g. outside market hours) and confirm an immediate fallback quote arrives instead of silence.
