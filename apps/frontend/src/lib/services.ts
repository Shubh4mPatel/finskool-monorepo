import type { TicketAttachment } from "@/lib/tickets";

export type ServiceRequestStatus = "requested" | "quote_sent" | "paid" | "closed";
export type ServiceClosedReason = "completed" | "declined" | "cancelled_by_member";
export type QuoteStatus = "active" | "superseded" | "expired" | "paid" | "cancelled";
export type ServiceEventType =
  | "created"
  | "assigned"
  | "reassigned"
  | "quote_sent"
  | "quote_superseded"
  | "quote_expired"
  | "paid"
  | "closed"
  | "cancelled"
  | "payment_flagged"
  | "review_resolved";

export interface ServiceQuote {
  id: string;
  requestId: string;
  version: number;
  baseAmount: number;
  gstRatePercent: number;
  gstAmount: number;
  totalAmount: number;
  currency: "INR";
  note: string | null;
  expiresAt: string;
  status: QuoteStatus;
  createdAt: string;
}

export interface ServiceInvoiceSummary {
  id: string;
  number: string;
  issuedAt: string;
  total: number;
}

export interface ServiceMessage {
  id: string;
  requestId: string;
  senderId: string | null;
  senderRole: "user" | "admin" | "system";
  senderName: string;
  kind: "text" | "quote" | "system";
  body: string | null;
  quote: ServiceQuote | null;
  clientMessageId: string | null;
  attachments: TicketAttachment[];
  createdAt: string;
}

export interface AdminServiceRequest {
  id: string;
  number: number;
  label: string;
  status: ServiceRequestStatus;
  closedReason: ServiceClosedReason | null;
  needs: string;
  attachments: TicketAttachment[];
  lastMessageAt: string;
  paidAt: string | null;
  closedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
  createdAt: string;
  service: { id: string; name: string; title: string; imageUrl: string | null };
  user: { id: string; name: string; phone: string };
  assignedAdmin: { id: string; name: string } | null;
  unreadCount: number;
  quote: ServiceQuote | null;
  invoice: ServiceInvoiceSummary | null;
  requiresReview: boolean;
  canReply: boolean;
  canClose: boolean;
}

export interface AdminServiceEvent {
  id: string;
  type: ServiceEventType;
  actorId: string | null;
  actorName: string | null;
  targetName: string | null;
  meta: unknown;
  createdAt: string;
}

export interface ServicePayment {
  id: string;
  quoteId: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amount: number;
  status: "authorized" | "captured" | "failed";
  method: string | null;
  settledVia: "verify" | "webhook" | null;
  errorDescription: string | null;
  createdAt: string;
}

export interface AdminServiceRequestDetail extends AdminServiceRequest {
  events: AdminServiceEvent[];
  quotes: ServiceQuote[];
  payments: ServicePayment[];
}

export interface ServiceStats {
  unassigned: number;
  mine: number;
  mineUnread: number;
  requested: number;
  quoteSent: number;
  paid: number;
  closed: number;
  needsReview: number;
  averageRating: number | null;
  ratingCount: number;
}

export interface ServiceTypeOption {
  key: string;
  label: string;
}

export interface CatalogService {
  id: string;
  /** Internal label (defaults to the service name). */
  name: string;
  /** The service name members see. */
  title: string;
  /** Markdown. */
  description: string;
  imageUrl: string | null;
  iconUrl: string | null;
  serviceType: ServiceTypeOption | null;
  /** Hashtags without the '#'. */
  tags: string[];
  /** Up to 3 short key facts shown as chips on the card. */
  highlights: string[];
  /** What the member gets, in display order. */
  whatMembersGet: string[];
  isActive: boolean;
  /** Requests for this service that are not closed yet. */
  openRequests: number;
  createdAt: string;
  updatedAt: string;
}

export const SERVICE_LIMITS = { tags: 10, highlights: 3, points: 8 } as const;

export interface BillingSettings {
  legalName: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  gstin: string | null;
  sacCode: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  footerNote: string | null;
  defaultGstRatePercent: number;
  defaultQuoteExpiryDays: number;
  invoicePrefix: string;
  isConfigured: boolean;
  updatedAt: string;
}

export interface QuoteDefaults {
  configured: boolean;
  defaultGstRatePercent: number;
  defaultQuoteExpiryDays: number;
}

export interface GstState {
  code: string;
  name: string;
}

// Viewer-neutral snapshot pushed over /ws/tickets (see backend requestSummary).
export interface ServiceRequestSummary {
  id: string;
  number: number;
  label: string;
  serviceId: string;
  serviceTitle: string;
  status: ServiceRequestStatus;
  closedReason: ServiceClosedReason | null;
  assignedAdmin: { id: string; name: string } | null;
  unreadCount: number;
  lastMessageAt: string;
  rating: number | null;
  paidAt: string | null;
  closedAt: string | null;
  quote: ServiceQuote | null;
  invoiceNumber: string | null;
  requiresReview: boolean;
}

export type LiveServiceEvent =
  | { event: "service.created"; requestId: string; data: { request: ServiceRequestSummary } }
  | { event: "service.updated"; requestId: string; data: { request: ServiceRequestSummary } }
  | {
      event: "service.message";
      requestId: string;
      data: { message: ServiceMessage; request: ServiceRequestSummary; supersededQuoteId?: string | null };
    }
  | { event: "service.read"; requestId: string; data: { unreadCount: number } };

export const SERVICE_STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  requested: "Requested",
  quote_sent: "Quote sent",
  paid: "Paid",
  closed: "Closed",
};

export const CLOSED_REASON_LABEL: Record<ServiceClosedReason, string> = {
  completed: "Completed",
  declined: "Declined",
  cancelled_by_member: "Cancelled by member",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  active: "Awaiting payment",
  superseded: "Replaced by a newer quote",
  expired: "Expired",
  paid: "Paid",
  cancelled: "Withdrawn",
};

/** "₹11,800.00" */
export function formatInr(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * GST on top of a base amount, rounded half-up to the paisa — the same maths the server uses, so the
 * preview in the send-quote form always matches the quote that comes back.
 */
export function previewQuote(base: number, ratePercent: number): { gst: number; total: number } | null {
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(ratePercent) || ratePercent < 0) return null;
  const basePaise = Math.round(base * 100);
  const gstPaise = Math.floor((basePaise * Math.round(ratePercent * 100) + 5000) / 10000);
  return { gst: gstPaise / 100, total: (basePaise + gstPaise) / 100 };
}

/** Closed requests read "Closed · Completed"; everything else is its stage. */
export function statusText(status: ServiceRequestStatus, closedReason: ServiceClosedReason | null): string {
  return status === "closed" && closedReason ? `Closed · ${CLOSED_REASON_LABEL[closedReason]}` : SERVICE_STATUS_LABEL[status];
}
