import { useSyncExternalStore } from "react";
import { liveStockPricesStore } from "./liveStockPricesStore";
import type { StockTick, MarketStatus } from "./liveStockPricesStore";

export function useStockTick(symbol: string): StockTick | undefined {
  return useSyncExternalStore(
    (listener) => liveStockPricesStore.subscribeTicks(listener),
    () => liveStockPricesStore.getTicksSnapshot()[symbol],
  );
}

export function useMarketStatus(): MarketStatus {
  return useSyncExternalStore(
    (listener) => liveStockPricesStore.subscribeMarketStatus(listener),
    () => liveStockPricesStore.getMarketStatusSnapshot(),
  );
}
