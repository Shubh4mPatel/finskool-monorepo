"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Download, FileText, Loader2, ReceiptText, Search, SearchX, TrendingUp, X, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Select, { pillClass } from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import Pagination from "@/components/ui/Pagination";
import { Card, EmptyState, Pill, Skeleton, TH } from "@/components/admin/dashboard/Panel";
import { UserAvatar } from "@/components/admin/UserAvatar";
import PdfViewerModal from "@/components/admin/PdfViewerModal";
import type { StatusTone } from "@/lib/dashboard";
import {
  DATE_RANGE_OPTIONS,
  STATUS_LABEL,
  dateRangeOf,
  istDate,
  istTime,
  planLabel,
  type DateRangeKey,
  type Transaction,
  type TransactionFilterOptions,
  type TransactionPage,
  type TransactionStats,
  type TransactionStatus,
} from "@/lib/transactions";

const PAGE_SIZE = 10;
const DEFAULT_RANGE: DateRangeKey = "30d";

type Tab = "all" | "communities" | "services";

const STATUS_TONE: Record<TransactionStatus, StatusTone> = { paid: "success", failed: "danger", flagged: "warning" };

/** ₹5,999 for a whole amount, ₹2,360.50 when there are paise. */
function rupees(amount: number): string {
  const whole = Number.isInteger(amount);
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

const num = (n: number) => n.toLocaleString("en-IN");

function isStatus(v: string | null): v is TransactionStatus {
  return v === "paid" || v === "failed" || v === "flagged";
}

function KpiTile({ icon, label, value, hint, tone = "default", delay }: { icon: React.ReactNode; label: string; value: string; hint: string; tone?: "default" | "good" | "bad"; delay: number }) {
  return (
    <Card delay={delay} interactive>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-background text-subtle">{icon}</span>
      </div>
      <p className="mt-2 font-display text-[28px] font-bold leading-none tracking-tight text-primary tabular-nums">{value}</p>
      <p className={`mt-2 text-xs font-semibold ${tone === "good" ? "text-accent" : tone === "bad" ? "text-red-500" : "text-muted"}`}>{hint}</p>
    </Card>
  );
}

function TransactionsContent() {
  const toast = useToast();
  const params = useSearchParams();
  const highlight = params.get("request");
  const initialStatus = params.get("status");

  const [tab, setTab] = useState<Tab>("all");
  const [paidFor, setPaidFor] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState<TransactionStatus | "">(isStatus(initialStatus) ? initialStatus : "");
  // A link from a flagged-payment notification wants every date, not just the last 30 days.
  const [range, setRange] = useState<DateRangeKey>(isStatus(initialStatus) ? "all" : DEFAULT_RANGE);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  // The page of rows on screen, and the filters + page it was fetched for: while those differ from the current ones, a new
  // page is on its way.
  const [loaded, setLoaded] = useState<{ res: TransactionPage; key: string } | null>(null);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [stats, setStats] = useState<TransactionStats | null>(null);
  const [options, setOptions] = useState<TransactionFilterOptions | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openingInvoice, setOpeningInvoice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ url: string; title: string; fileName: string } | null>(null);
  const tableRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const dates = useMemo(() => (range === "custom" ? { from: customFrom, to: customTo } : dateRangeOf(range)), [range, customFrom, customTo]);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (tab !== "all") p.set("type", tab);
    if (status) p.set("status", status);
    if (paidFor) p.set("paidFor", paidFor);
    if (plan) p.set("plan", plan);
    if (dates.from) p.set("from", dates.from);
    if (dates.to) p.set("to", dates.to);
    if (debouncedSearch) p.set("search", debouncedSearch);
    return p.toString();
  }, [tab, status, paidFor, plan, dates, debouncedSearch]);

  // An inverted custom range is not sent: it would be a 400, and the pickers already stop it.
  const rangeInvalid = !!dates.from && !!dates.to && dates.from > dates.to;

  const query = `${filterParams}${filterParams ? "&" : ""}page=${page}&pageSize=${PAGE_SIZE}`;
  const data = loaded?.res ?? null;
  const loading = !rangeInvalid && !error && loaded?.key !== query;

  useEffect(() => {
    if (rangeInvalid) return;
    let cancelled = false;
    api
      .get<TransactionPage>(`/api/v1/admin/transactions?${query}`)
      .then(res => {
        if (cancelled) return;
        // Rows were removed meanwhile and this page no longer exists: land on the last one.
        if (res.items.length === 0 && page > 1 && res.totalPages < page) {
          setPage(res.totalPages);
          return;
        }
        setLoaded({ res, key: query });
        setError(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(true);
        toast.error(err instanceof ApiError ? err.message : "Failed to load transactions");
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, rangeInvalid, reloadTick, toast]);

  useEffect(() => {
    api.get<TransactionStats>("/api/v1/admin/transactions/stats").then(setStats).catch(() => setStats(null));
    api.get<TransactionFilterOptions>("/api/v1/admin/transactions/filters").then(setOptions).catch(() => setOptions(null));
  }, []);

  function change<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  const hasFilters = !!(paidFor || plan || status || search || range !== DEFAULT_RANGE);
  function clearFilters() {
    setPaidFor("");
    setPlan("");
    setStatus("");
    setRange(DEFAULT_RANGE);
    setCustomFrom("");
    setCustomTo("");
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function exportExcel() {
    setExporting(true);
    try {
      // The same filters as the list, without the paging.
      const blob = await api.getBlob(`/api/v1/admin/transactions/export/xlsx?${filterParams}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to export transactions");
    } finally {
      setExporting(false);
    }
  }

  // Shown inside the admin app, as on the member profile, not in a separate tab.
  async function openInvoice(t: Transaction) {
    if (!t.invoice) return;
    setOpeningInvoice(t.id);
    try {
      const { url, fileName } = await api.get<{ url: string; fileName: string }>(t.invoice.downloadPath);
      setViewing({ url, fileName, title: `${t.kind === "community" ? "Receipt" : "Invoice"} ${t.invoice.number}` });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open the invoice");
    } finally {
      setOpeningInvoice(null);
    }
  }

  const paidForOptions = useMemo(
    () => [
      { value: "", label: "All" },
      ...(options?.communities ?? []).map(c => ({ value: c.id, label: c.name, hint: "Community" })),
      ...(options?.services ?? []).map(s => ({ value: s.id, label: s.title, hint: "Service" })),
    ],
    [options],
  );
  const planOptions = useMemo(() => [{ value: "", label: "All" }, ...(options?.planMonths ?? []).map(m => ({ value: String(m), label: planLabel(m) }))], [options]);

  const rows = data?.items ?? [];
  const counts = data?.counts;
  const total = data?.total ?? 0;
  const tabs: { key: Tab; label: string; count: number | undefined }[] = [
    { key: "all", label: "All", count: counts?.all },
    { key: "communities", label: "Communities", count: counts?.community },
    { key: "services", label: "Services", count: counts?.service },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter">
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Transactions</p>
        <h1 className="font-display text-2xl font-bold text-primary">Transactions</h1>
        <p className="mt-1 text-sm text-muted">All payments members made for communities and services.</p>
      </div>

      {/* KPIs: everything the admin can see, whatever the list below is filtered to */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats ? (
          <>
            <KpiTile delay={40} icon={<CircleDollarSign size={16} />} label="Total collected" value={rupees(stats.totalCollected.amount)} hint={`All time, ${num(stats.totalCollected.payments)} payments`} />
            <KpiTile delay={100} icon={<TrendingUp size={16} />} label="This month" value={rupees(stats.thisMonth.amount)} hint={`${num(stats.thisMonth.payments)} payments in ${stats.thisMonth.label}`} />
            <KpiTile
              delay={160}
              icon={<CheckCircle2 size={16} />}
              label="Successful payments"
              value={num(stats.successful.count)}
              hint={stats.successful.ratePercent === null ? "No payments yet" : `${stats.successful.ratePercent}% success rate`}
              tone="good"
            />
            <KpiTile delay={220} icon={<XCircle size={16} />} label="Failed payments" value={num(stats.failed.count)} hint="No money deducted" tone={stats.failed.count > 0 ? "bad" : "default"} />
          </>
        ) : (
          [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[116px] rounded-2xl" />)
        )}
      </div>

      {/* Money that reached Razorpay but was not applied: the old "Payment flags" list */}
      {stats && stats.flagged.count > 0 && (
        <div role="status" className="animate-enter flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-bold">{num(stats.flagged.count)} {stats.flagged.count === 1 ? "payment needs" : "payments need"} review.</span> The money reached Razorpay but could not be applied. Refund it in
            Razorpay, then mark the review resolved on the request.
          </p>
          {status !== "flagged" && (
            <button
              type="button"
              onClick={() => {
                setStatus("flagged");
                setRange("all");
                setTab("all");
                setPage(1);
              }}
              className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline"
            >
              Show them <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}

      <section ref={tableRef} className="animate-enter scroll-mt-4 rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "260ms" }}>
        <div className="flex flex-col gap-4 border-b border-divider p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-primary">All transactions</h2>
              <p className="text-xs text-muted">Community and service payments, newest first.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex w-full min-w-[240px] items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10 sm:w-80">
                <Search size={15} className="shrink-0 text-subtle" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by member, invoice or payment ID"
                  aria-label="Search transactions"
                  className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={exportExcel}
                disabled={total === 0 || exporting}
                className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                <Download size={14} className="text-lime" />
                {exporting ? "Exporting…" : "Export Excel"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div role="tablist" aria-label="Type" className="flex items-center gap-1.5">
              {tabs.map(t => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
                  }}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    tab === t.key ? "bg-primary text-white" : "border border-divider bg-white text-muted hover:border-subtle hover:text-primary"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${tab === t.key ? "bg-lime text-primary" : "bg-divider text-muted"}`}>{num(t.count)}</span>
                  )}
                </button>
              ))}
            </div>
            <span className="mx-1 hidden h-6 w-px bg-divider sm:block" aria-hidden />
            <Select
              value={paidFor}
              onChange={change(setPaidFor)}
              ariaLabel="Paid for"
              leading={<span className="text-subtle">Paid for:</span>}
              options={paidForOptions}
              triggerClassName={`${pillClass(!!paidFor)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={plan}
              onChange={change(setPlan)}
              ariaLabel="Plan"
              leading={<span className="text-subtle">Plan:</span>}
              options={planOptions}
              triggerClassName={`${pillClass(!!plan)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={range}
              onChange={change((v: string) => setRange(v as DateRangeKey))}
              ariaLabel="Date"
              leading={<span className="text-subtle">Date:</span>}
              options={DATE_RANGE_OPTIONS}
              triggerClassName={`${pillClass(range !== DEFAULT_RANGE)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            {range === "custom" && (
              <>
                <DatePicker variant="pill" label="From" value={customFrom} onChange={change(setCustomFrom)} />
                <DatePicker variant="pill" label="To" value={customTo} onChange={change(setCustomTo)} />
              </>
            )}
            <Select
              value={status}
              onChange={change((v: string) => setStatus(isStatus(v) ? v : ""))}
              ariaLabel="Status"
              leading={<span className="text-subtle">Status:</span>}
              options={[{ value: "", label: "All" }, ...(["paid", "failed", "flagged"] as const).map(s => ({ value: s, label: STATUS_LABEL[s] }))]}
              triggerClassName={`${pillClass(!!status)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary">
                Clear
              </button>
            )}
          </div>
          {rangeInvalid && <p role="alert" className="text-xs font-semibold text-red-500">The start date is after the end date.</p>}
        </div>

        {loading && !data ? (
          <div className="space-y-3 p-5" aria-label="Loading transactions">
            {[0, 1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error && !data ? (
          <EmptyState icon={<AlertTriangle size={18} />}>
            Could not load the transactions.{" "}
            <button type="button" onClick={() => { setError(false); setReloadTick(t => t + 1); }} className="font-bold text-accent hover:underline">
              Try again
            </button>
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={hasFilters ? <SearchX size={20} /> : <ReceiptText size={20} />}>
            {hasFilters || tab !== "all" ? "No transactions match these filters. Try adjusting or clearing them." : "No payments yet. They appear here as members pay."}
          </EmptyState>
        ) : (
          <div aria-busy={loading} className={`transition-opacity duration-300 ${loading ? "pointer-events-none opacity-50" : "opacity-100"}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-background/70">
                  <tr>
                    <th className={`${TH} pl-5`}>Invoice</th>
                    <th className={TH}>Member</th>
                    <th className={TH}>Paid for</th>
                    <th className={`${TH} text-right`}>Amount</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Date</th>
                    <th className={`${TH} pr-5`}>
                      <span className="sr-only">Invoice file</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => (
                    <tr
                      key={t.id}
                      data-testid="transaction-row"
                      className={`border-b border-divider/70 align-middle transition-colors last:border-b-0 hover:bg-background/60 ${
                        highlight && t.requestId === highlight ? "bg-amber-50/60 ring-1 ring-inset ring-amber-200" : ""
                      }`}
                    >
                      <td className="py-3.5 pl-5 pr-3">
                        <p className="font-bold tabular-nums text-primary">{t.invoice?.number ?? "—"}</p>
                        <p className="max-w-[170px] truncate text-[11px] text-subtle" title={t.paymentId ?? undefined}>
                          {t.paymentId ?? "—"}
                        </p>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={t.member.name} className="h-8 w-8" />
                          <span className="min-w-0 max-w-[170px] truncate font-semibold text-primary" title={t.member.email ?? undefined}>
                            {t.member.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="max-w-[220px] truncate font-semibold text-primary">{t.paidFor.name}</p>
                        <p className="text-[11px] text-muted">{t.kind === "community" ? (t.planMonths ? `${planLabel(t.planMonths)} plan` : t.planName) : t.reference}</p>
                      </td>
                      <td className={`px-3 py-3.5 text-right font-bold tabular-nums ${t.status === "paid" ? "text-primary" : "text-subtle"}`}>{rupees(t.amount)}</td>
                      <td className="px-3 py-3.5">
                        <span title={t.reason ?? undefined}>
                          <Pill tone={STATUS_TONE[t.status]} dot>
                            {STATUS_LABEL[t.status]}
                          </Pill>
                        </span>
                        {t.reason && <p className="mt-1 max-w-[200px] truncate text-[11px] text-muted" title={t.reason}>{t.reason}</p>}
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="font-medium text-primary">{istDate(t.occurredAt)}</p>
                        <p className="text-[11px] text-muted">{istTime(t.occurredAt)}</p>
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        {t.invoice ? (
                          <button
                            type="button"
                            onClick={() => openInvoice(t)}
                            disabled={openingInvoice === t.id}
                            aria-label={`View invoice ${t.invoice.number}`}
                            title="View invoice"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-divider/60 hover:text-accent disabled:opacity-60"
                          >
                            {openingInvoice === t.id ? <Loader2 size={15} className="animate-spin" /> : <FileText size={16} />}
                          </button>
                        ) : t.status === "flagged" && t.requestId ? (
                          <Link href={`/admin/services/${t.requestId}`} className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline">
                            Open <ArrowRight size={13} />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination className="px-5 pb-4" page={page} pageSize={PAGE_SIZE} total={total} noun={total === 1 ? "transaction" : "transactions"} onPage={goToPage} />
          </div>
        )}
      </section>
      {viewing && <PdfViewerModal title={viewing.title} url={viewing.url} fileName={viewing.fileName} onClose={() => setViewing(null)} />}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsContent />
    </Suspense>
  );
}
