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
