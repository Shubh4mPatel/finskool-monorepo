import { addDays, endOfMonth, startOfToday, toDateParam } from "@/lib/dates";

// Mirrors the admin transactions API (backend: modules/transactions).

export type TransactionKind = "community" | "service";
export type TransactionStatus = "paid" | "failed" | "flagged";

export interface Transaction {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  occurredAt: string;
  amount: number;
  currency: string;
  member: { id: string; name: string; email: string | null };
  paidFor: { id: string; name: string };
  planMonths: number | null;
  planName: string | null;
  /** Services: "SR-12 · Quote 1". */
  reference: string | null;
  paymentId: string | null;
  orderId: string | null;
  method: string | null;
  /** Why it failed or was flagged. */
  reason: string | null;
  invoice: { id: string; number: string; downloadPath: string } | null;
  requestId: string | null;
}

export interface TransactionPage {
  items: Transaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: { all: number; community: number; service: number };
}

export interface TransactionStats {
  totalCollected: { amount: number; payments: number };
  thisMonth: { amount: number; payments: number; label: string };
  successful: { count: number; ratePercent: number | null };
  failed: { count: number };
  flagged: { count: number };
}

export interface TransactionFilterOptions {
  communities: { id: string; name: string }[];
  services: { id: string; title: string }[];
  planMonths: number[];
}

export const STATUS_LABEL: Record<TransactionStatus, string> = { paid: "Paid", failed: "Failed", flagged: "Flagged" };

const PLAN_NAMES: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly" };

/** "Quarterly" for 3, "18 months" for a length nobody named. */
export function planLabel(months: number): string {
  return PLAN_NAMES[months] ?? `${months} months`;
}

export type DateRangeKey = "all" | "today" | "7d" | "30d" | "month" | "last-month" | "custom";

export const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

/** The first and last day (`YYYY-MM-DD`) a preset covers; empty strings leave that side open. */
export function dateRangeOf(key: Exclude<DateRangeKey, "custom">, today: Date = startOfToday()): { from: string; to: string } {
  switch (key) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return { from: toDateParam(today), to: toDateParam(today) };
    case "7d":
      return { from: toDateParam(addDays(today, -6)), to: toDateParam(today) };
    case "30d":
      return { from: toDateParam(addDays(today, -29)), to: toDateParam(today) };
    case "month":
      return { from: toDateParam(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateParam(today) };
    case "last-month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: toDateParam(first), to: toDateParam(endOfMonth(first)) };
    }
  }
}

const IST = "Asia/Kolkata";

/** "13 Nov 2026" and "10:24 AM", both in IST: the time the server's reports use. */
export function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
}
export function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST }).toUpperCase();
}
