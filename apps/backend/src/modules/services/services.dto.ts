import type {
  ServiceClosedReason,
  ServiceEventType,
  ServiceMessageKind,
  ServiceRequestStatus,
  ServiceSenderRole,
} from '../../generated/prisma/client.js'
import type { TicketAttachmentDTO } from '../tickets/tickets.dto.js'

export type ServiceAttachmentDTO = TicketAttachmentDTO

export type ServiceQuoteStatusDTO = 'active' | 'superseded' | 'expired' | 'paid' | 'cancelled'

/** A quote as shown in the chat card and on the request. Amounts are rupees. */
export interface ServiceQuoteDTO {
  id: string
  requestId: string
  version: number
  baseAmount: number
  gstRatePercent: number
  gstAmount: number
  totalAmount: number
  currency: 'INR'
  note: string | null
  expiresAt: string
  // Effective status: a quote past its expiry reads as `expired` even before the sweep records it.
  status: ServiceQuoteStatusDTO
  createdAt: string
}

export interface ServiceInvoiceSummaryDTO {
  id: string
  number: string
  issuedAt: string
  total: number
}

/** What the member's app needs to open Razorpay Checkout. `amount` is in paise. */
export interface PayOrderDTO {
  orderId: string
  amount: number
  currency: 'INR'
  keyId: string
  quoteId: string
  requestId: string
}

export interface ServicePaymentDTO {
  id: string
  quoteId: string | null
  razorpayOrderId: string
  razorpayPaymentId: string
  amount: number
  status: 'authorized' | 'captured' | 'failed'
  method: string | null
  settledVia: 'verify' | 'webhook' | null
  errorDescription: string | null
  createdAt: string
}

export interface BillingSettingsDTO {
  legalName: string | null
  addressLine: string | null
  city: string | null
  pincode: string | null
  stateCode: string | null
  gstin: string | null
  sacCode: string | null
  contactEmail: string | null
  contactPhone: string | null
  footerNote: string | null
  defaultGstRatePercent: number
  defaultQuoteExpiryDays: number
  invoicePrefix: string
  /** True once the seller details needed to send quotes and issue invoices are all set. */
  isConfigured: boolean
  updatedAt: string
}

export interface QuoteDefaultsDTO {
  configured: boolean
  defaultGstRatePercent: number
  defaultQuoteExpiryDays: number
}

export interface ListPage<T> {
  items: T[]
  nextCursor: string | null
}

/** A catalog entry as members see it (no internal `name`). */
export interface MemberServiceDTO {
  id: string
  title: string
  description: string
  imageUrl: string | null
}

/** A catalog entry as admins see it. */
export interface AdminServiceDTO extends MemberServiceDTO {
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ServiceMessageDTO {
  id: string
  requestId: string
  senderId: string | null
  senderRole: ServiceSenderRole
  senderName: string
  kind: ServiceMessageKind
  body: string | null
  // Set on kind = quote: the card to show (its status is current, so a replaced quote reads superseded).
  quote: ServiceQuoteDTO | null
  clientMessageId: string | null
  attachments: ServiceAttachmentDTO[]
  createdAt: string
}

interface ServiceRequestBaseDTO {
  id: string
  number: number
  label: string // SR-<number>
  status: ServiceRequestStatus
  closedReason: ServiceClosedReason | null
  needs: string
  attachments: ServiceAttachmentDTO[] // attached to the original request
  lastMessageAt: string
  paidAt: string | null
  closedAt: string | null
  rating: number | null
  ratingComment: string | null
  ratedAt: string | null
  createdAt: string
}

/** What the requesting member (mobile app) sees. */
export interface MemberServiceRequestDTO extends ServiceRequestBaseDTO {
  service: { id: string; title: string; imageUrl: string | null }
  assignedAdminName: string | null
  unreadCount: number
  // The payable quote (or the paid one); null when there is none right now.
  quote: ServiceQuoteDTO | null
  invoice: ServiceInvoiceSummaryDTO | null
}

/** What a support admin (web dashboard) sees. */
export interface AdminServiceRequestDTO extends ServiceRequestBaseDTO {
  service: { id: string; name: string; title: string; imageUrl: string | null }
  user: { id: string; name: string; phone: string }
  assignedAdmin: { id: string; name: string } | null
  unreadCount: number
  quote: ServiceQuoteDTO | null
  invoice: ServiceInvoiceSummaryDTO | null
  // Money arrived that the request couldn't absorb: refund it in the Razorpay dashboard, then resolve.
  requiresReview: boolean
  // Per requesting admin. canReply: an open request the admin owns, or that nobody owns yet (a
  // reply claims it), or any open one for a super admin. canClose: the owner or a super admin.
  canReply: boolean
  canClose: boolean
}

export interface AdminServiceEventDTO {
  id: string
  type: ServiceEventType
  actorId: string | null
  actorName: string | null
  // For assigned / reassigned: the admin the request went to.
  targetName: string | null
  meta: unknown
  createdAt: string
}

export interface AdminServiceRequestDetailDTO extends AdminServiceRequestDTO {
  events: AdminServiceEventDTO[]
  quotes: ServiceQuoteDTO[]
  payments: ServicePaymentDTO[]
}

export interface AdminServiceStatsDTO {
  unassigned: number
  mine: number
  mineUnread: number
  requested: number
  quoteSent: number
  paid: number
  closed: number
  needsReview: number
  averageRating: number | null
  ratingCount: number
}
