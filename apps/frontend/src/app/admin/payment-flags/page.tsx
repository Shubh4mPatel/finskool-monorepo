"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { fetchCursorPage } from "@/lib/cursorPages";
import { formatInr } from "@/lib/services";
import type { AdminServiceRequest } from "@/lib/services";
import { timeAgo } from "@/lib/tickets";
import type { TicketPage } from "@/lib/tickets";
import { EmptyState, Skeleton } from "@/components/admin/dashboard/Panel";
import { UserAvatar } from "@/components/admin/UserAvatar";
import Pagination from "@/components/ui/Pagination";

const PAGE_SIZE = 10;
const listUrl = (cursor?: string) =>
  `/api/v1/admin/services?review=true&limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

// Payments that reached Razorpay but could not be applied (amount mismatch, quote already replaced...).
// An admin refunds them in Razorpay, then resolves the flag on the request. Notifications land here.
function PaymentFlagsContent() {
  const highlight = useSearchParams().get("request");
  const [rows, setRows] = useState<AdminServiceRequest[] | null>(null);
  const [error, setError] = useState(false);
  const [now] = useState(() => Date.now());
  const [page, setPage] = useState(1);
  // The page the rows on screen belong to: while it differs from `page`, a new page is on its way.
  const [loadedPage, setLoadedPage] = useState(1);
  // Flagged payments across every page — what the page numbers are counted from.
  const [total, setTotal] = useState(0);
  // The server pages by cursor; the cursors met so far let a click on a page number go straight there.
  const cursors = useRef<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchCursorPage((cursor) => api.get<TicketPage<AdminServiceRequest>>(listUrl(cursor)), page, cursors.current);
      cursors.current = res.cursors;
      setRows(res.data.items);
      setTotal(res.data.total ?? res.data.items.length);
      setLoadedPage(res.page);
      // Flags were resolved meanwhile and this page is gone: land on the last one that exists.
      if (res.page !== page) setPage(res.page);
      setError(false);
    } catch {
      setError(true);
    }
  }, [page]);

  function goToPage(next: number) {
    setPage(next);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter">
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Payment flags</p>
        <h1 className="font-display text-2xl font-bold text-primary">Payment flags</h1>
        <p className="mt-1 text-sm text-muted">
          Payments the member made that could not be applied to their request. Refund them in Razorpay, then mark the review resolved on the request.
        </p>
      </div>

      <div ref={listRef} className="scroll-mt-4 overflow-hidden rounded-2xl border border-divider bg-white">
        {rows === null && !error ? (
          <div className="flex flex-col gap-3 p-5" aria-label="Loading">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={<AlertTriangle size={18} />}>Could not load the flagged payments. Refresh to try again.</EmptyState>
        ) : rows && rows.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={18} />}>Nothing to review. Every payment was applied.</EmptyState>
        ) : (
          rows?.map(r => (
            <Link
              key={r.id}
              href={`/admin/services/${r.id}`}
              data-testid="payment-flag-row"
              className={`group flex flex-wrap items-center gap-4 border-b border-divider/70 px-5 py-4 text-sm text-primary transition-colors last:border-b-0 hover:bg-background/60 ${
                highlight === r.id ? "bg-red-50/60 ring-1 ring-inset ring-red-200" : ""
              }`}
            >
              <AlertTriangle size={16} className="shrink-0 text-red-500" aria-hidden />
              <span className="w-20 font-bold tabular-nums">#{r.label}</span>
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar name={r.user.name} avatarUrl={r.user.avatarUrl} className="h-9 w-9" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.user.name}</span>
                  <span className="block truncate text-[11px] text-muted">{r.service.title}</span>
                </span>
              </span>
              <span className="w-28 font-semibold tabular-nums">{r.quote ? formatInr(r.quote.totalAmount) : "-"}</span>
              <span className="w-24 text-[11px] text-muted">{timeAgo(r.lastMessageAt, now)}</span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-accent">
                Open <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))
        )}
        {rows && rows.length > 0 && !error && (
          <Pagination
            className={`px-5 pb-4 transition-opacity duration-300 ${loadedPage !== page ? "opacity-50" : ""}`}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun={total === 1 ? "flagged payment" : "flagged payments"}
            onPage={goToPage}
          />
        )}
      </div>
    </div>
  );
}

export default function PaymentFlagsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentFlagsContent />
    </Suspense>
  );
}
