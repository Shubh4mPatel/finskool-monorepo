export interface MemberSubscription {
  id: string;
  communityId: string;
  communityName: string;
  payment: number;
  paidOn: string | null;
  validUntil: string;
  isActive: boolean;
}

export interface MemberItem {
  id: string;
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  isRegistered: boolean;
  status: "registered" | "pending" | "expired" | "suspended" | "deleted";
  createdAt: string;
  suspensionReason: string | null;
  subscription: MemberSubscription | null;
  allSubscriptions: MemberSubscription[];
}

export const STATUS_STYLES: Record<string, string> = {
  registered: "bg-accent/10 text-accent",
  pending: "bg-amber-100 text-amber-600",
  expired: "bg-red-100 text-red-500",
  suspended: "bg-gray-100 text-gray-500",
  deleted: "bg-gray-200 text-gray-600",
};

export const STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  pending: "Pending Sign",
  expired: "Expired",
  suspended: "Suspended",
  deleted: "Deleted",
};

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
