"use client";

import { useEffect } from "react";
import { liveStockPricesStore } from "./liveStockPricesStore";

export default function LiveStockPricesProvider() {
  useEffect(() => {
    liveStockPricesStore.connect();
  }, []);

  return null;
}
