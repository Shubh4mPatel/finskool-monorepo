"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the OS asks for less motion. Server render assumes yes, so it ships the final value. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}

const defaultFormat = (n: number): string => Math.round(n).toLocaleString("en-IN");

/** A number that counts up from 0 to `value` (ease-out) — or just shows it, if motion is reduced. */
export function CountUp({
  value,
  format = defaultFormat,
  duration = 1000,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return <>{format(reduced ? value : shown)}</>;
}
