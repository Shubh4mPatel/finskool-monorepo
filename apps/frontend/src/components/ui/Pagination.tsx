"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** Page numbers to show: all of them up to 7, otherwise the first, the last and a window around the current one. */
export function getPaginationPages(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, null, total];
  if (current >= total - 3) return [1, null, total - 4, total - 3, total - 2, total - 1, total];
  return [1, null, current - 1, current, current + 1, null, total];
}

/**
 * "Showing 1-10 of 28 trades" with numbered pages and Previous / Next, the same control the Members list uses.
 * The numbers appear only when there is more than one page; the count line always does.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  noun,
  onPage,
  className = "",
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Plural, for the count line: "trades", "members". */
  noun: string;
  onPage: (page: number) => void;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const num = (n: number) => n.toLocaleString("en-IN");

  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 border-t border-divider pt-4 ${className}`}>
      <p className="text-sm text-muted">
        Showing <span className="font-semibold tabular-nums text-primary">{from === to ? num(from) : `${num(from)}-${num(to)}`}</span> of{" "}
        <span className="font-semibold tabular-nums text-primary">{num(total)}</span> {noun}
      </p>
      {totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          {getPaginationPages(page, totalPages).map((n, idx) =>
            n === null ? (
              <span key={`gap-${idx}`} className="px-1 text-sm text-subtle">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={`h-8 w-8 rounded-full text-sm font-semibold tabular-nums transition-all ${
                  n === page ? "bg-primary text-white shadow-glow" : "text-muted hover:bg-divider/60 hover:text-primary"
                }`}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight size={15} />
          </button>
        </nav>
      )}
    </div>
  );
}
