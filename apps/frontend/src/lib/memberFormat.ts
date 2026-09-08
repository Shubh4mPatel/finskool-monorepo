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
  id: string; // User.id
  approvedPhoneId: string | null; // present only when source === "admin"
  source: "admin" | "self";
  name: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  accountStatus: "active" | "suspended" | "deleted";
  registrationStatus: "pending" | "registered" | null; // null for source === "self"
  hasActiveSubscription: boolean;
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

// Single compact badge for the members table — mirrors the old backend
// deriveMemberStatus's precedence (account standing beats registration
// progress beats subscription validity) so the visual footprint stays close
// to what a "status" column used to show, while the 3 real fields
// (accountStatus/registrationStatus/hasActiveSubscription) remain available
// independently for filters/CSV. registrationStatus === null (self-registered)
// falls through to the last line, same as an admin-added member whose
// ApprovedPhone.status is "registered" — correct, since "registered" here
// just means "has a real, currently-valid subscription."
export function getDisplayStatus(m: MemberItem): { label: string; style: string } {
  if (m.accountStatus === "suspended") {
    return { label: ACCOUNT_STATUS_LABELS.suspended, style: ACCOUNT_STATUS_STYLES.suspended };
  }
  if (m.accountStatus === "deleted") {
    return { label: ACCOUNT_STATUS_LABELS.deleted, style: ACCOUNT_STATUS_STYLES.deleted };
  }
  if (m.registrationStatus === "pending") {
    return { label: REGISTRATION_STATUS_LABELS.pending, style: REGISTRATION_STATUS_STYLES.pending };
  }
  return m.hasActiveSubscription
    ? { label: REGISTRATION_STATUS_LABELS.registered, style: REGISTRATION_STATUS_STYLES.registered }
    : { label: "Expired", style: "bg-red-100 text-red-500" };
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
