"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

type Result<T> = { key: string; data: T } | { key: string; error: string };

export interface Panel<T> {
  /** The latest data — while `refreshing`, still the previous key's, so the panel can hold its frame. */
  data: T | null;
  error: string | null;
  /** Nothing to show yet (first load, or after a retry). */
  loading: boolean;
  /** The key changed and new data is on its way; `data` is the previous render. */
  refreshing: boolean;
  retry: () => void;
}

/**
 * Loads one dashboard panel independently, so a slow or failing panel never blocks the others.
 * `key` identifies what is being loaded (e.g. the chart's month): changing it loads again. Rather
 * than blanking to a skeleton, the previous data stays up and `refreshing` goes true.
 */
export function usePanel<T>(key: string, fetcher: () => Promise<T>): Panel<T> {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then(data => !cancelled && setResult({ key, data }))
      .catch(err => {
        if (cancelled) return;
        setResult({ key, error: err instanceof ApiError ? err.message : "Could not load this section" });
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt(a => a + 1);
  }, []);

  const stale = result !== null && result.key !== key;
  const data = result && "data" in result ? result.data : null;
  return {
    data,
    error: result && "error" in result && !stale ? result.error : null,
    loading: result === null || (stale && data === null),
    refreshing: stale,
    retry,
  };
}
