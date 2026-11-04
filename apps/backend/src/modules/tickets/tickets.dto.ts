import type { TicketCategory, TicketStatus, TicketType, TicketSenderRole, TicketEventType } from '../../generated/prisma/client.js'

export interface TicketAttachmentDTO {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  // Presigned, short-lived (~5 min). Re-fetch via the attachment-url endpoint once expired.
  url: string
}

export interface TicketMessageDTO {
  id: string
  ticketId: string
  senderId: string
  senderRole: TicketSenderRole
  senderName: string
  /** The sender's profile picture, null when they have none (show their initials). */
  senderAvatarUrl: string | null
  body: string | null
  clientMessageId: string
  attachments: TicketAttachmentDTO[]
  createdAt: string
}

interface TicketBaseDTO {
  id: string
  number: number
  label: string // FS-<number>
  communityId: string
  communityName: string
  category: TicketCategory
  type: TicketType
  subject: string
  description: string
  status: TicketStatus
  attachments: TicketAttachmentDTO[] // attached to the original description
  lastMessageAt: string
  rating: number | null
  ratingComment: string | null
  ratedAt: string | null
  resolvedAt: string | null
  createdAt: string
}

/** What the ticket owner (mobile app) sees. */
export interface UserTicketDTO extends TicketBaseDTO {
  assignedAdminName: string | null
  unreadCount: number
}

/** What a support admin (web dashboard) sees. */
export interface AdminTicketDTO extends TicketBaseDTO {
  user: { id: string; name: string; phone: string; avatarUrl: string | null }
  assignedAdmin: { id: string; name: string; avatarUrl: string | null } | null
  unreadCount: number
  // Per requesting admin: assignee (or super admin) on an unresolved ticket can resolve; same
  // plus any admin on an unassigned ticket can reply (reply auto-claims).
  canReply: boolean
  canResolve: boolean
}

export interface AdminTicketEventDTO {
  id: string
  type: TicketEventType
  actorId: string
  actorName: string
  // For assigned / reassigned: the admin the ticket went to.
  targetName: string | null
  meta: unknown
  createdAt: string
}

export interface AdminTicketDetailDTO extends AdminTicketDTO {
  events: AdminTicketEventDTO[]
}

export interface TicketListPage<T> {
  items: T[]
  nextCursor: string | null
}

/** The admin's list also says how many tickets match the filters in all, so the screen can number its pages. */
export interface AdminTicketListPage extends TicketListPage<AdminTicketDTO> {
  /** Tickets matching the filters across every page (the cursor is not part of the filters). */
  total: number
}

export interface TicketCommunityOptionDTO {
  id: string
  name: string
  isFree: boolean
}

export interface TicketUploadUrlDTO {
  uploadUrl: string
  objectKey: string
}

export interface AdminTicketStatsDTO {
  unassigned: number
  mine: number
  mineUnread: number
  inProgress: number
  resolved: number
  averageRating: number | null
  ratingCount: number
}
