"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

type Result<T> = { key: string; data: T } | { key: string; error: string };

export interface Panel<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

/**
 * Loads one dashboard panel independently, so a slow or failing panel never blocks the others.
 * `key` identifies what is being loaded (e.g. the chart's month): changing it loads again, and
 * until the new result lands the panel reports `loading` rather than showing stale data.
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

  const current = result && result.key === key ? result : null;
  return {
    data: current && "data" in current ? current.data : null,
    error: current && "error" in current ? current.error : null,
    loading: current === null,
    retry,
  };
}
