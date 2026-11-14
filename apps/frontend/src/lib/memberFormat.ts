import { parseDateParam, startOfToday } from "@/lib/dates";

/** True when `newDate` would end a plan that is still running earlier than it ends now (the member is told it was reduced). */
export function isReducingPlan(currentEnd: string | null | undefined, newDate: string): boolean {
  if (!currentEnd || !newDate) return false;
  const end = parseDateParam(currentEnd);
  const next = parseDateParam(newDate);
  return !!end && !!next && end >= startOfToday() && next < end;
}

export interface MemberSubscription {
  id: string;
  communityId: string;
  communityName: string;
  /** The free community: part of every account, it can only be removed by suspending the whole account. */
  isFree: boolean;
  payment: number;
  paidOn: string | null;
  /** null = no expiry (the free community). */
  validUntil: string | null;
  isActive: boolean;
  /** Set while an admin has blocked the member in this community only (their account and other communities work). */
  block: { reason: string; blockedAt: string } | null;
}

export type MemberDisplayStatus = "active" | "pending" | "suspended" | "deleted";

export interface MemberItem {
  id: string; // User.id
  approvedPhoneId: string | null; // present only when source === "admin"
  source: "admin" | "self";
  name: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  accountStatus: "active" | "suspended" | "deleted";
  /**
   * What the Status column shows: deleted, then suspended (the whole account, or blocked from a community), then pending
   * (no password yet), else active. A paid plan running or lapsed is not a status; see the Valid Till column.
   */
  status: MemberDisplayStatus;
  registrationStatus: "pending" | "registered" | null; // pending = no password set yet; null = signed up on their own (source === "self")
  hasActiveSubscription: boolean;
  /** Holds (or held) a paid plan. False for a member who is only in the free community, who is never "Expired". */
  hasPaidSubscription: boolean;
  createdAt: string;
  suspensionReason: string | null;
  subscription: MemberSubscription | null;
  allSubscriptions: MemberSubscription[];
}

export const ACCOUNT_STATUS_STYLES: Record<MemberItem["accountStatus"], string> = {
  active: "bg-accent/10 text-accent",
  suspended: "bg-gray-100 text-gray-500",
  deleted: "bg-gray-200 text-gray-600",
};

export const ACCOUNT_STATUS_LABELS: Record<MemberItem["accountStatus"], string> = {
  active: "Active",
  suspended: "Suspended",
  deleted: "Deleted",
};

const DISPLAY_STATUS: Record<MemberDisplayStatus, { label: string; style: string }> = {
  active: { label: "Active", style: "bg-accent/10 text-accent" },
  pending: { label: "Pending", style: "bg-amber-100 text-amber-600" },
  suspended: { label: "Suspended", style: "bg-gray-100 text-gray-500" },
  deleted: { label: "Deleted", style: "bg-gray-200 text-gray-600" },
};

export const REGISTRATION_STATUS_STYLES: Record<"pending" | "registered", string> = {
  pending: "bg-amber-100 text-amber-600",
  registered: "bg-accent/10 text-accent",
};

export const REGISTRATION_STATUS_LABELS: Record<"pending" | "registered", string> = {
  pending: "Pending Sign",
  registered: "Registered",
};

export const SOURCE_LABELS: Record<MemberItem["source"], string> = {
  admin: "Admin-added",
  self: "Self-registered",
};

// The badge in the members table. The status is worked out once by the server (the same value the Status filter and the
// Excel export use), so the badge, the filter and the file always agree.
export function getDisplayStatus(m: MemberItem): { label: string; style: string } {
  return DISPLAY_STATUS[m.status];
}

export function getInitials(name: string): string {
  return name.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function communityBadge(name: string): string {
  const colors = ["bg-lime/40 text-primary", "bg-accent/10 text-accent", "bg-amber-100 text-amber-600"];
  return colors[name.charCodeAt(0) % colors.length] ?? "bg-divider text-muted";
}
