"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0] px-4">
      <div className="animate-rise flex w-full max-w-md flex-col items-center gap-6 rounded-2xl bg-white p-10 text-center shadow-card">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-4xl font-bold text-red-400">
          !
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold text-primary">Something went wrong</h1>
          <p className="text-sm text-subtle">
            An unexpected error occurred. You can try again or go back to the home page.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="rounded-full border border-accent px-6 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5"
          >
            Try Again
          </button>
          <Link
            href="/feed"
            className="rounded-full bg-gradient-to-r from-lime to-accent px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
          >
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
