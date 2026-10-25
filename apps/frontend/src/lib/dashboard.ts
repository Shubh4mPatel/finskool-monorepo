import { api } from "@/lib/api";

// Mirrors apps/backend/src/modules/dashboard/dashboard.dto.ts — one endpoint per panel.

export interface DashboardKpis {
  totalMembers: { value: number; newThisMonth: number };
  activeSubscriptions: { value: number; pendingRegistration: number };
  revenue: {
    amount: number;
    previousAmount: number;
    /** null when last month had no revenue to compare against. */
    deltaPercent: number | null;
    from: string; // YYYY-MM-DD
    through: string; // YYYY-MM-DD
  };
  tickets: { openTickets: number; openEnquiries: number; awaitingFirstReply: number };
}

export interface RevenuePoint {
  day: number;
  date: string;
  amount: number;
}

export interface DashboardRevenue {
  month: string; // YYYY-MM
  previousMonth: string;
  throughDay: number;
  current: RevenuePoint[];
  previous: RevenuePoint[];
  totalCurrent: number;
  totalPrevious: number;
  deltaPercent: number | null;
}

export interface ExpiringSubscription {
  subscriptionId: string;
  userId: string;
  name: string;
  initials: string;
  communityId: string;
  communityName: string;
  validUntil: string;
  daysLeft: number;
}

export interface DashboardExpiring {
  items: ExpiringSubscription[];
  total: number;
  windowDays: number;
}

export interface RegistrationItem {
  userId: string;
  name: string;
  initials: string;
  phone: string;
  email: string | null;
  registeredAt: string;
  source: "self" | "admin";
  communityName: string | null;
  accountStatus: "active" | "suspended";
  registrationStatus: "registered" | "pending";
}

export interface DashboardRegistrations {
  items: RegistrationItem[];
  last7DaysCount: number;
}

export type StatusTone = "danger" | "warning" | "info" | "success" | "neutral";

export interface DashboardTicketItem {
  id: string;
  kind: "support" | "service";
  label: string;
  member: { id: string; name: string; initials: string };
  typeLabel: string;
  subject: string;
  status: { key: string; label: string; tone: StatusTone };
  lastUpdateAt: string;
}

export interface DashboardTickets {
  items: DashboardTicketItem[];
}

const BASE = "/api/v1/admin/dashboard";

export const dashboardApi = {
  kpis: () => api.get<DashboardKpis>(`${BASE}/kpis`),
  revenue: (month: string) => api.get<DashboardRevenue>(`${BASE}/revenue?month=${month}`),
  expiring: () => api.get<DashboardExpiring>(`${BASE}/expiring?limit=5`),
  registrations: () => api.get<DashboardRegistrations>(`${BASE}/registrations?limit=5`),
  tickets: () => api.get<DashboardTickets>(`${BASE}/tickets?limit=5`),
};

// ─── formatting ─────────────────────────────────────────────────────────────

const MONTH_FORMAT: Intl.DateTimeFormatOptions = { month: "short", timeZone: "UTC" };

/** "Oct" for "2026-10" (or any YYYY-MM[-DD]) — read as UTC so the viewer's timezone can't shift it. */
export function shortMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", MONTH_FORMAT);
}

/** "October" for "2026-10". */
export function longMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/** "1–25 Oct" for a from/through pair inside one month. */
export function dayRange(from: string, through: string): string {
  return `${Number(from.slice(8, 10))}–${Number(through.slice(8, 10))} ${shortMonth(through)}`;
}

/** "40K", "1.5L" — compact rupee axis labels (lakh, not million, for an Indian audience). */
export function compactRupees(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${+(n / 1000).toFixed(1)}K`;
  return `${+(n / 100_000).toFixed(1)}L`;
}

/** Whole rupees with Indian digit grouping: ₹1,44,025. */
export function rupees(n: number, decimals = 0): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
