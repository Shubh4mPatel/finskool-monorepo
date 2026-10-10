import { Prisma } from '../../generated/prisma/client.js'
import {
  deleteTicketObject,
  generateTicketDownloadUrl,
  generateTicketUploadUrl,
  inspectTicketAttachment,
  ticketAttachmentExtension,
} from '../../lib/minio.js'
import { BadRequestError } from '../../shared/errors/index.js'
import type {
  AdminTicketDTO,
  TicketAttachmentDTO,
  TicketMessageDTO,
  TicketUploadUrlDTO,
  UserTicketDTO,
} from './tickets.dto.js'
import type { PresignDTO } from './tickets.validator.js'

export const ticketInclude = {
  community: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, phone: true } },
  assignedAdmin: { select: { id: true, name: true } },
  attachments: { where: { messageId: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TicketInclude

export const messageInclude = {
  sender: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TicketMessageInclude

export type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>
export type MessageRow = Prisma.TicketMessageGetPayload<{ include: typeof messageInclude }>
type AttachmentRow = Prisma.TicketAttachmentGetPayload<object>

export interface AdminViewer {
  id: string
  isSuperAdmin: boolean
}

export const ticketLabel = (number: number): string => `FS-${number}`

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// ─── Cursors ────────────────────────────────────────────────────────────────
// Opaque "<iso timestamp>|<id>" — keyset pagination on (timestamp desc, id desc),
// so pages stay stable while new rows arrive at the top.

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url')
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  const at = new Date(iso ?? '')
  if (!id || Number.isNaN(at.getTime())) throw new BadRequestError('Invalid cursor', 'INVALID_CURSOR')
  return { at, id }
}

// ─── Attachments ────────────────────────────────────────────────────────────

export async function createUploadUrl(uploaderId: string, dto: PresignDTO): Promise<TicketUploadUrlDTO> {
  const ext = ticketAttachmentExtension(dto.fileName)
  if (!ext) {
    throw new BadRequestError('Only JPG, PNG, WebP images and PDF files are allowed', 'ATTACHMENT_INVALID')
  }
  return generateTicketUploadUrl(uploaderId, ext)
}

/**
 * Verifies every uploaded key (ownership prefix, size, real file type) and returns
 * the attachment rows to create. Rejects the whole request if any one is bad.
 */
export async function resolveAttachments(
  uploaderId: string,
  refs: { objectKey: string; fileName: string }[],
): Promise<{ objectKey: string; fileName: string; mimeType: string; sizeBytes: number }[]> {
  if (new Set(refs.map(r => r.objectKey)).size !== refs.length) {
    throw new BadRequestError('Duplicate attachment', 'ATTACHMENT_INVALID')
  }
  const checked = await Promise.all(
    refs.map(async ref => ({ ref, info: await inspectTicketAttachment(ref.objectKey, uploaderId) })),
  )
  const bad = checked.filter(c => !c.info)
  if (bad.length > 0) {
    // Only ever delete objects under the caller's own prefix.
    await Promise.all(
      bad.filter(b => b.ref.objectKey.startsWith(`tickets/${uploaderId}/`)).map(b => deleteTicketObject(b.ref.objectKey)),
    )
    throw new BadRequestError(
      'An attachment is missing, larger than 5 MB, or not an image/PDF',
      'ATTACHMENT_INVALID',
    )
  }
  return checked.map(({ ref, info }) => ({
    objectKey: ref.objectKey,
    fileName: ref.fileName,
    mimeType: info!.mimeType,
    sizeBytes: info!.size,
  }))
}

async function mapAttachment(a: AttachmentRow): Promise<TicketAttachmentDTO> {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: await generateTicketDownloadUrl(a.objectKey, a.fileName),
  }
}

export async function freshAttachmentUrl(a: AttachmentRow): Promise<string> {
  return generateTicketDownloadUrl(a.objectKey, a.fileName)
}

// ─── Mapping ────────────────────────────────────────────────────────────────

export async function mapMessage(m: MessageRow): Promise<TicketMessageDTO> {
  return {
    id: m.id,
    ticketId: m.ticketId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: m.sender.name,
    body: m.body,
    clientMessageId: m.clientMessageId,
    attachments: await Promise.all(m.attachments.map(mapAttachment)),
    createdAt: m.createdAt.toISOString(),
  }
}

async function mapBase(t: TicketRow) {
  return {
    id: t.id,
    number: t.number,
    label: ticketLabel(t.number),
    communityId: t.communityId,
    communityName: t.community.name,
    category: t.category,
    type: t.type,
    subject: t.subject,
    description: t.description,
    status: t.status,
    attachments: await Promise.all(t.attachments.map(mapAttachment)),
    lastMessageAt: t.lastMessageAt.toISOString(),
    rating: t.rating,
    ratingComment: t.ratingComment,
    ratedAt: t.ratedAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }
}

export async function mapUserTicket(t: TicketRow): Promise<UserTicketDTO> {
  return {
    ...(await mapBase(t)),
    assignedAdminName: t.assignedAdmin?.name ?? null,
    unreadCount: t.userUnreadCount,
  }
}

export async function mapAdminTicket(t: TicketRow, viewer: AdminViewer): Promise<AdminTicketDTO> {
  const open = t.status !== 'resolved'
  const isAssignee = t.assignedAdminId === viewer.id
  return {
    ...(await mapBase(t)),
    user: t.user,
    assignedAdmin: t.assignedAdmin,
    unreadCount: t.adminUnreadCount,
    canReply: open && (viewer.isSuperAdmin || isAssignee || t.assignedAdminId === null),
    canResolve: open && (viewer.isSuperAdmin || isAssignee),
  }
}

// ─── Realtime payloads ──────────────────────────────────────────────────────
// One event is fanned out to many recipients, so it can't carry per-viewer
// fields (canReply / canResolve). Events carry this lean, viewer-neutral
// summary; clients merge it into their list/detail state (or refetch the detail).

export function ticketSummary(t: TicketRow, side: 'user' | 'admin') {
  return {
    id: t.id,
    number: t.number,
    label: ticketLabel(t.number),
    communityId: t.communityId,
    category: t.category,
    type: t.type,
    subject: t.subject,
    status: t.status,
    assignedAdmin: t.assignedAdmin,
    unreadCount: side === 'user' ? t.userUnreadCount : t.adminUnreadCount,
    lastMessageAt: t.lastMessageAt.toISOString(),
    rating: t.rating,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  }
}
