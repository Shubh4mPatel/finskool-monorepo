import { useSyncExternalStore } from "react";
import { liveStockPricesStore } from "./liveStockPricesStore";
import type { StockTick, MarketStatus } from "./liveStockPricesStore";

export function useStockTick(symbol: string): StockTick | undefined {
  return useSyncExternalStore(
    (listener) => liveStockPricesStore.subscribeTicks(listener),
    () => liveStockPricesStore.getTicksSnapshot()[symbol],
    // Server snapshot: the store's WebSocket never connects until
    // LiveStockPricesProvider's client-only effect fires, so on the server
    // this is always the same untouched initial state as the client snapshot.
    () => liveStockPricesStore.getTicksSnapshot()[symbol],
  );
}

export function useMarketStatus(): MarketStatus {
  return useSyncExternalStore(
    (listener) => liveStockPricesStore.subscribeMarketStatus(listener),
    () => liveStockPricesStore.getMarketStatusSnapshot(),
    () => liveStockPricesStore.getMarketStatusSnapshot(),
  );
}

export interface LiveCmpAndReturn {
  cmp: number | null;
  returnPercent: number | null;
  isLive: boolean;
}

/** Overlays a live AngelOne tick (if one has arrived over the WS feed) on top of the last REST-fetched cmp/returnPercent for this row. */
export function useLiveCmpAndReturn(row: {
  symbol: string;
  entryPrice: number;
  cmp: number | null;
  returnPercent: number | null;
}): LiveCmpAndReturn {
  const tick = useStockTick(row.symbol);
  if (!tick) return { cmp: row.cmp, returnPercent: row.returnPercent, isLive: false };

  const returnPercent = row.entryPrice !== 0
    ? Number((((tick.ltp - row.entryPrice) / row.entryPrice) * 100).toFixed(2))
    : null;
  return { cmp: tick.ltp, returnPercent, isLive: true };
}
