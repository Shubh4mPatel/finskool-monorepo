import type {
  ServiceClosedReason,
  ServiceEventType,
  ServiceMessageKind,
  ServiceRequestStatus,
  ServiceSenderRole,
} from '../../generated/prisma/client.js'
import type { TicketAttachmentDTO } from '../tickets/tickets.dto.js'

export type ServiceAttachmentDTO = TicketAttachmentDTO

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
}

/** What a support admin (web dashboard) sees. */
export interface AdminServiceRequestDTO extends ServiceRequestBaseDTO {
  service: { id: string; name: string; title: string; imageUrl: string | null }
  user: { id: string; name: string; phone: string }
  assignedAdmin: { id: string; name: string } | null
  unreadCount: number
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
}

export interface AdminServiceStatsDTO {
  unassigned: number
  mine: number
  mineUnread: number
  requested: number
  quoteSent: number
  paid: number
  closed: number
  averageRating: number | null
  ratingCount: number
}
