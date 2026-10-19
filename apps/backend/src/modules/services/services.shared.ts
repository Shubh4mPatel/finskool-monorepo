import { Prisma } from '../../generated/prisma/client.js'
import { generateTicketDownloadUrl } from '../../lib/minio.js'
import type { AdminViewer } from '../tickets/tickets.shared.js'
import type {
  AdminServiceDTO,
  AdminServiceRequestDTO,
  MemberServiceDTO,
  MemberServiceRequestDTO,
  ServiceAttachmentDTO,
  ServiceMessageDTO,
} from './services.dto.js'

// Cursors, unique-violation detection and attachment checks are the same as for tickets.
export { decodeCursor, encodeCursor, isUniqueViolation, isUuid, resolveAttachments } from '../tickets/tickets.shared.js'

export const requestInclude = {
  service: { select: { id: true, name: true, title: true, imageUrl: true } },
  user: { select: { id: true, name: true, phone: true } },
  assignedAdmin: { select: { id: true, name: true } },
  attachments: { where: { messageId: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ServiceRequestInclude

export const messageInclude = {
  sender: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ServiceMessageInclude

export type ServiceRequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>
export type ServiceMessageRow = Prisma.ServiceMessageGetPayload<{ include: typeof messageInclude }>
type AttachmentRow = Prisma.ServiceAttachmentGetPayload<object>
type ServiceRow = Prisma.ServiceGetPayload<object>

export const requestLabel = (number: number): string => `SR-${number}`

/** A request is "open" until it is closed. */
export const isOpen = (r: { status: string }): boolean => r.status !== 'closed'

// ─── Catalog ────────────────────────────────────────────────────────────────

export function mapMemberService(s: ServiceRow): MemberServiceDTO {
  return { id: s.id, title: s.title, description: s.description, imageUrl: s.imageUrl }
}

export function mapAdminService(s: ServiceRow): AdminServiceDTO {
  return {
    ...mapMemberService(s),
    name: s.name,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

// ─── Messages ───────────────────────────────────────────────────────────────

async function mapAttachment(a: AttachmentRow): Promise<ServiceAttachmentDTO> {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: await generateTicketDownloadUrl(a.objectKey, a.fileName, a.mimeType),
  }
}

export function freshAttachmentUrl(a: AttachmentRow): Promise<string> {
  return generateTicketDownloadUrl(a.objectKey, a.fileName, a.mimeType)
}

export async function mapMessage(m: ServiceMessageRow): Promise<ServiceMessageDTO> {
  return {
    id: m.id,
    requestId: m.requestId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: m.sender?.name ?? 'Finskool',
    kind: m.kind,
    body: m.body,
    clientMessageId: m.clientMessageId,
    attachments: await Promise.all(m.attachments.map(mapAttachment)),
    createdAt: m.createdAt.toISOString(),
  }
}

// ─── Requests ───────────────────────────────────────────────────────────────

async function mapBase(r: ServiceRequestRow) {
  return {
    id: r.id,
    number: r.number,
    label: requestLabel(r.number),
    status: r.status,
    closedReason: r.closedReason,
    needs: r.needs,
    attachments: await Promise.all(r.attachments.map(mapAttachment)),
    lastMessageAt: r.lastMessageAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    rating: r.rating,
    ratingComment: r.ratingComment,
    ratedAt: r.ratedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function mapMemberRequest(r: ServiceRequestRow): Promise<MemberServiceRequestDTO> {
  return {
    ...(await mapBase(r)),
    service: { id: r.service.id, title: r.service.title, imageUrl: r.service.imageUrl },
    assignedAdminName: r.assignedAdmin?.name ?? null,
    unreadCount: r.userUnreadCount,
  }
}

export async function mapAdminRequest(r: ServiceRequestRow, viewer: AdminViewer): Promise<AdminServiceRequestDTO> {
  const open = isOpen(r)
  const isAssignee = r.assignedAdminId === viewer.id
  return {
    ...(await mapBase(r)),
    service: { id: r.service.id, name: r.service.name, title: r.service.title, imageUrl: r.service.imageUrl },
    user: r.user,
    assignedAdmin: r.assignedAdmin,
    unreadCount: r.adminUnreadCount,
    canReply: open && (viewer.isSuperAdmin || isAssignee || r.assignedAdminId === null),
    canClose: open && (viewer.isSuperAdmin || isAssignee),
  }
}

// ─── Realtime payloads ──────────────────────────────────────────────────────
// One event fans out to many recipients, so it carries this lean, viewer-neutral summary
// (no per-viewer canReply / canClose). Clients merge it into their list state or refetch.

export function requestSummary(r: ServiceRequestRow, side: 'member' | 'admin') {
  return {
    id: r.id,
    number: r.number,
    label: requestLabel(r.number),
    serviceId: r.service.id,
    serviceTitle: r.service.title,
    status: r.status,
    closedReason: r.closedReason,
    assignedAdmin: r.assignedAdmin,
    unreadCount: side === 'member' ? r.userUnreadCount : r.adminUnreadCount,
    lastMessageAt: r.lastMessageAt.toISOString(),
    rating: r.rating,
    paidAt: r.paidAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  }
}
