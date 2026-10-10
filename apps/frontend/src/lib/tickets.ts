export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketCategory = "payments" | "subscription" | "account" | "content" | "app_bug" | "other";
export type TicketType = "issue" | "question" | "feature_request" | "refund_request";

export interface TicketAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: "user" | "admin";
  senderName: string;
  body: string | null;
  clientMessageId: string;
  attachments: TicketAttachment[];
  createdAt: string;
}

export interface AdminTicket {
  id: string;
  number: number;
  label: string;
  communityId: string;
  communityName: string;
  category: TicketCategory;
  type: TicketType;
  subject: string;
  description: string;
  status: TicketStatus;
  attachments: TicketAttachment[];
  lastMessageAt: string;
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; phone: string };
  assignedAdmin: { id: string; name: string } | null;
  unreadCount: number;
  canReply: boolean;
  canResolve: boolean;
}

export interface AdminTicketEvent {
  id: string;
  type: "created" | "assigned" | "reassigned" | "resolved";
  actorId: string;
  actorName: string;
  targetName: string | null;
  meta: { toAdminId?: string; fromAdminId?: string | null } | null;
  createdAt: string;
}

export interface AdminTicketDetail extends AdminTicket {
  events: AdminTicketEvent[];
}

export interface TicketPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TicketStats {
  unassigned: number;
  mine: number;
  mineUnread: number;
  inProgress: number;
  resolved: number;
  averageRating: number | null;
  ratingCount: number;
}

// Viewer-neutral snapshot pushed over /ws/tickets (see backend ticketSummary).
export interface TicketSummary {
  id: string;
  number: number;
  label: string;
  communityId: string;
  category: TicketCategory;
  type: TicketType;
  subject: string;
  status: TicketStatus;
  assignedAdmin: { id: string; name: string } | null;
  unreadCount: number;
  lastMessageAt: string;
  rating: number | null;
  resolvedAt: string | null;
}

export type LiveTicketEvent =
  | { event: "ticket.created"; ticketId: string; communityId: string; data: { ticket: TicketSummary } }
  | { event: "ticket.updated"; ticketId: string; communityId: string; data: { ticket: TicketSummary } }
  | { event: "ticket.message"; ticketId: string; communityId: string; data: { message: TicketMessage; ticket: TicketSummary } }
  | { event: "ticket.read"; ticketId: string; communityId: string; data: { unreadCount: number } };

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  payments: "Payments",
  subscription: "Subscription",
  account: "Account",
  content: "Content",
  app_bug: "App Bug",
  other: "Other",
};

export const TYPE_LABEL: Record<TicketType, string> = {
  issue: "Issue",
  question: "Question",
  feature_request: "Feature Request",
  refund_request: "Refund Request",
};

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export function formatTicketTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
