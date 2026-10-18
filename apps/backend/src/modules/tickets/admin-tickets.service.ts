import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { getCommunityAdminIds, hasCommunityAccess } from '../../lib/community-access.js'
import { publishTicketEvent } from '../../lib/live-tickets-feed.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import type {
  AdminTicketDetailDTO,
  AdminTicketDTO,
  AdminTicketStatsDTO,
  TicketListPage,
  TicketMessageDTO,
  TicketUploadUrlDTO,
} from './tickets.dto.js'
import type {
  AdminListTicketsQuery,
  ListMessagesQuery,
  PresignDTO,
  SendMessageDTO,
} from './tickets.validator.js'
import {
  createUploadUrl,
  decodeCursor,
  encodeCursor,
  freshAttachmentUrl,
  isUniqueViolation,
  mapAdminTicket,
  mapMessage,
  messageInclude,
  resolveAttachments,
  ticketInclude,
  ticketSummary,
} from './tickets.shared.js'
import type { AdminViewer, TicketRow } from './tickets.shared.js'

// Prisma's `contains` doesn't escape LIKE wildcards, so "%" / "_" in a search would match everything.
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&')

export interface AdminActor extends AdminViewer {
  // null = unrestricted (super admin); otherwise the exact communities this admin may see.
  accessibleCommunityIds: string[] | null
}

/**
 * The support team's side (web dashboard). Scoping rules:
 *  - visibility: only tickets of communities the admin has access to (super admin: all);
 *    anything else is a 404 so ids can't be probed;
 *  - one admin owns a ticket: the first to claim/reply becomes the assignee; other admins
 *    can read but not reply or resolve; a super admin can always reply/resolve/reassign.
 */
export class AdminTicketsService {
  constructor(private readonly db: PrismaClient) {}

  createUploadUrl(admin: AdminActor, dto: PresignDTO): Promise<TicketUploadUrlDTO> {
    return createUploadUrl(admin.id, dto)
  }

  async list(admin: AdminActor, query: AdminListTicketsQuery): Promise<TicketListPage<AdminTicketDTO>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const where: Prisma.TicketWhereInput[] = [this.scope(admin)]

    if (query.communityId) where.push({ communityId: query.communityId })
    if (query.userId) where.push({ userId: query.userId })
    if (query.status) where.push({ status: query.status })
    if (query.category) where.push({ category: query.category })
    if (query.type) where.push({ type: query.type })
    if (query.open === 'true') where.push({ status: { not: 'resolved' } })
    if (query.unread === 'true') where.push({ adminUnreadCount: { gt: 0 } })
    if (query.assignee === 'unassigned') where.push({ assignedAdminId: null })
    else if (query.assignee === 'me') where.push({ assignedAdminId: admin.id })
    else if (query.assignee) where.push({ assignedAdminId: query.assignee })
    if (query.search) {
      // "12" / "FS-12" is a ticket number. Digits only and capped at 9 so it always fits the
      // 32-bit column (Number() would accept "1e3" / "0x1f" and overflow on long input).
      const idMatch = /^(?:fs-)?(\d{1,9})$/i.exec(query.search)
      const number = idMatch ? Number(idMatch[1]) : 0
      const text = escapeLike(query.search)
      where.push({
        OR: [
          { subject: { contains: text, mode: 'insensitive' } },
          ...(number > 0 ? [{ number }] : []),
          { user: { name: { contains: text, mode: 'insensitive' } } },
        ],
      })
    }
    if (cursor) {
      where.push({ OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }] })
    }

    const rows = await this.db.ticket.findMany({
      where: { AND: where },
      include: ticketInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page[page.length - 1]
    return {
      items: await Promise.all(page.map(t => mapAdminTicket(t, admin))),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    }
  }

  /** Numbers for the sidebar badge / inbox header. */
  async stats(admin: AdminActor): Promise<AdminTicketStatsDTO> {
    const scope = this.scope(admin)
    const [unassigned, mine, mineUnread, inProgress, resolved, ratings] = await Promise.all([
      this.db.ticket.count({ where: { AND: [scope, { assignedAdminId: null, status: { not: 'resolved' } }] } }),
      this.db.ticket.count({ where: { AND: [scope, { assignedAdminId: admin.id, status: { not: 'resolved' } }] } }),
      this.db.ticket.count({
        where: { AND: [scope, { assignedAdminId: admin.id, status: { not: 'resolved' }, adminUnreadCount: { gt: 0 } }] },
      }),
      this.db.ticket.count({ where: { AND: [scope, { status: 'in_progress' }] } }),
      this.db.ticket.count({ where: { AND: [scope, { status: 'resolved' }] } }),
      this.db.ticket.aggregate({ where: { AND: [scope, { rating: { not: null } }] }, _avg: { rating: true }, _count: { rating: true } }),
    ])
    return {
      unassigned,
      mine,
      mineUnread,
      inProgress,
      resolved,
      averageRating: ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 10) / 10,
      ratingCount: ratings._count.rating,
    }
  }

  async get(admin: AdminActor, ticketId: string): Promise<AdminTicketDetailDTO> {
    const ticket = await this.getVisible(admin, ticketId)
    const events = await this.db.ticketEvent.findMany({
      where: { ticketId },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const targetIds = [
      ...new Set(
        events
          .map(e => (e.meta as { toAdminId?: string } | null)?.toAdminId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ]
    const targets = targetIds.length
      ? await this.db.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
      : []
    const targetName = new Map(targets.map(t => [t.id, t.name]))
    return {
      ...(await mapAdminTicket(ticket, admin)),
      events: events.map(e => ({
        id: e.id,
        type: e.type,
        actorId: e.actorId,
        actorName: e.actor.name,
        targetName: targetName.get((e.meta as { toAdminId?: string } | null)?.toAdminId ?? '') ?? null,
        meta: e.meta,
        createdAt: e.createdAt.toISOString(),
      })),
    }
  }

  async listMessages(
    admin: AdminActor,
    ticketId: string,
    query: ListMessagesQuery,
  ): Promise<TicketListPage<TicketMessageDTO>> {
    await this.getVisible(admin, ticketId)
    const cursor = query.before ? decodeCursor(query.before) : null
    const rows = await this.db.ticketMessage.findMany({
      where: {
        ticketId,
        ...(cursor
          ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page[page.length - 1]
    return {
      items: await Promise.all(page.map(mapMessage)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    }
  }

  async claim(admin: AdminActor, ticketId: string): Promise<AdminTicketDTO> {
    const ticket = await this.getVisible(admin, ticketId)
    if (ticket.status === 'resolved') throw this.resolvedError()
    if (ticket.assignedAdminId === admin.id) return mapAdminTicket(ticket, admin) // already mine — idempotent

    const claimed = await this.db.$transaction(async tx => this.claimInTx(tx, ticketId, admin.id))
    if (!claimed) {
      const current = await this.getVisible(admin, ticketId)
      if (current.assignedAdminId === admin.id) return mapAdminTicket(current, admin)
      throw new ConflictError('This ticket is already assigned to another admin', 'TICKET_ALREADY_ASSIGNED')
    }
    const fresh = await this.getVisible(admin, ticketId)
    await this.publishUpdated(fresh)
    return mapAdminTicket(fresh, admin)
  }

  /** Super admin only: hand the ticket to another admin who has access to its community. */
  async reassign(admin: AdminActor, ticketId: string, toAdminId: string): Promise<AdminTicketDTO> {
    if (!admin.isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
    const ticket = await this.getVisible(admin, ticketId)
    if (ticket.status === 'resolved') throw this.resolvedError()
    if (ticket.assignedAdminId === toAdminId) return mapAdminTicket(ticket, admin)

    const eligible = await getCommunityAdminIds(this.db, ticket.communityId)
    if (!eligible.includes(toAdminId)) {
      throw new BadRequestError('That admin does not have access to this ticket\'s community', 'ADMIN_NOT_ELIGIBLE')
    }

    const changed = await this.db.$transaction(async tx => {
      const updated = await tx.ticket.updateMany({
        where: { id: ticketId, status: { not: 'resolved' } },
        data: { assignedAdminId: toAdminId, status: 'in_progress' },
      })
      if (updated.count === 0) return false
      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: ticket.assignedAdminId ? 'reassigned' : 'assigned',
          actorId: admin.id,
          meta: { toAdminId, fromAdminId: ticket.assignedAdminId },
        },
      })
      return true
    })
    if (!changed) throw this.resolvedError()

    const fresh = await this.getVisible(admin, ticketId)
    await this.publishUpdated(fresh)
    return mapAdminTicket(fresh, admin)
  }

  async reply(admin: AdminActor, ticketId: string, dto: SendMessageDTO): Promise<TicketMessageDTO> {
    const ticket = await this.getVisible(admin, ticketId)

    // Before the resolved / ownership checks: a retry of a message that was already stored (its
    // ack got lost and the ticket was resolved or reassigned meanwhile) gets that message back.
    const replay = await this.db.ticketMessage.findUnique({
      where: { uq_ticket_messages_client_id: { ticketId, clientMessageId: dto.clientMessageId } },
      include: messageInclude,
    })
    if (replay) return mapMessage(replay)
    if (ticket.status === 'resolved') throw this.resolvedError()
    this.assertCanAct(admin, ticket)

    const attachments = await resolveAttachments(admin.id, dto.attachments)

    let messageId: string
    try {
      messageId = await this.db.$transaction(async tx => {
        // First reply on an unassigned ticket claims it. The conditional claim means that if
        // another admin got there first, we fall through to re-checking ownership below.
        if (ticket.assignedAdminId === null) {
          await this.claimInTx(tx, ticketId, admin.id)
        }
        // Status and ownership are part of the WHERE, so they're re-evaluated under the row
        // lock: a resolve / reassign that lands after our read above matches zero rows here.
        const bumped = await tx.ticket.updateMany({
          where: {
            id: ticketId,
            status: { not: 'resolved' },
            ...(admin.isSuperAdmin ? {} : { assignedAdminId: admin.id }),
          },
          data: { lastMessageAt: new Date(), userUnreadCount: { increment: 1 } },
        })
        if (bumped.count === 0) {
          const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { status: true } })
          if (current.status === 'resolved') throw this.resolvedError()
          throw new ForbiddenError('This ticket is handled by another admin', 'TICKET_ASSIGNED_TO_OTHER')
        }
        const message = await tx.ticketMessage.create({
          data: {
            ticketId,
            senderId: admin.id,
            senderRole: 'admin',
            body: dto.body || null,
            clientMessageId: dto.clientMessageId,
            attachments: { create: attachments.map(a => ({ ...a, ticketId })) },
          },
          select: { id: true },
        })
        return message.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.db.ticketMessage.findUnique({
          where: { uq_ticket_messages_client_id: { ticketId, clientMessageId: dto.clientMessageId } },
          include: messageInclude,
        })
        if (winner) return mapMessage(winner)
      }
      throw err
    }

    const [message, fresh] = await Promise.all([
      this.db.ticketMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude }),
      this.getVisible(admin, ticketId),
    ])
    const dtoMessage = await mapMessage(message)
    const adminIds = await getCommunityAdminIds(this.db, fresh.communityId)
    await Promise.all([
      publishTicketEvent({
        userIds: [fresh.userId],
        event: 'ticket.message',
        ticketId,
        communityId: fresh.communityId,
        data: { message: dtoMessage, ticket: ticketSummary(fresh, 'user') },
      }),
      publishTicketEvent({
        userIds: adminIds,
        event: 'ticket.message',
        ticketId,
        communityId: fresh.communityId,
        data: { message: dtoMessage, ticket: ticketSummary(fresh, 'admin') },
      }),
    ])
    return dtoMessage
  }

  /** Assignee (or a super admin) marks it resolved — terminal; the chat becomes read-only. */
  async resolve(admin: AdminActor, ticketId: string): Promise<AdminTicketDTO> {
    const ticket = await this.getVisible(admin, ticketId)
    if (ticket.status === 'resolved') throw this.resolvedError()
    if (ticket.assignedAdminId === null && !admin.isSuperAdmin) {
      throw new ConflictError('Take the ticket before resolving it', 'TICKET_NOT_CLAIMED')
    }
    this.assertCanAct(admin, ticket)

    const resolved = await this.db.$transaction(async tx => {
      if (ticket.assignedAdminId === null) await this.claimInTx(tx, ticketId, admin.id)
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: { not: 'resolved' },
          ...(admin.isSuperAdmin ? {} : { assignedAdminId: admin.id }),
        },
        // Terminal: nothing is left for the support team to read, so drop the unread badge
        // (the member's own unread count is untouched — they may not have seen the last reply).
        data: { status: 'resolved', resolvedAt: new Date(), adminUnreadCount: 0 },
      })
      if (updated.count === 0) return false
      await tx.ticketEvent.create({ data: { ticketId, type: 'resolved', actorId: admin.id } })
      return true
    })
    if (!resolved) {
      const current = await this.getVisible(admin, ticketId)
      if (current.status === 'resolved') throw this.resolvedError()
      throw new ForbiddenError('This ticket is handled by another admin', 'TICKET_ASSIGNED_TO_OTHER')
    }

    const fresh = await this.getVisible(admin, ticketId)
    await this.publishUpdated(fresh)
    return mapAdminTicket(fresh, admin)
  }

  /**
   * Zeroes the unread badge. Only the assignee clears it — an admin merely looking at
   * someone else's (or an unassigned) ticket must not hide it from the person who owns it.
   */
  async markRead(admin: AdminActor, ticketId: string): Promise<{ unreadCount: number }> {
    const ticket = await this.getVisible(admin, ticketId)
    if (ticket.assignedAdminId !== admin.id || ticket.adminUnreadCount === 0) {
      return { unreadCount: ticket.adminUnreadCount }
    }
    await this.db.ticket.update({ where: { id: ticketId }, data: { adminUnreadCount: 0 } })
    await publishTicketEvent({
      userIds: [admin.id],
      event: 'ticket.read',
      ticketId,
      communityId: ticket.communityId,
      data: { unreadCount: 0 },
    })
    return { unreadCount: 0 }
  }

  async getAttachmentUrl(admin: AdminActor, ticketId: string, attachmentId: string): Promise<{ url: string }> {
    await this.getVisible(admin, ticketId)
    const attachment = await this.db.ticketAttachment.findFirst({ where: { id: attachmentId, ticketId } })
    if (!attachment) throw new NotFoundError('Attachment not found')
    return { url: await freshAttachmentUrl(attachment) }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private scope(admin: AdminActor): Prisma.TicketWhereInput {
    return admin.accessibleCommunityIds === null ? {} : { communityId: { in: admin.accessibleCommunityIds } }
  }

  private async getVisible(admin: AdminActor, ticketId: string): Promise<TicketRow> {
    const ticket = await this.db.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude })
    if (!ticket || !hasCommunityAccess(admin.accessibleCommunityIds, ticket.communityId)) {
      throw new NotFoundError('Ticket not found')
    }
    return ticket
  }

  // Other admins may look, but only the assignee / a super admin may act. Unassigned = anyone with access.
  private assertCanAct(admin: AdminActor, ticket: TicketRow): void {
    if (admin.isSuperAdmin || ticket.assignedAdminId === null || ticket.assignedAdminId === admin.id) return
    throw new ForbiddenError('This ticket is handled by another admin', 'TICKET_ASSIGNED_TO_OTHER')
  }

  /** Atomic "assign if still unassigned and open". Returns whether this call won the claim. */
  private async claimInTx(tx: Prisma.TransactionClient, ticketId: string, adminId: string): Promise<boolean> {
    const claimed = await tx.ticket.updateMany({
      where: { id: ticketId, assignedAdminId: null, status: { not: 'resolved' } },
      data: { assignedAdminId: adminId, status: 'in_progress' },
    })
    if (claimed.count === 0) return false
    await tx.ticketEvent.create({
      data: { ticketId, type: 'assigned', actorId: adminId, meta: { toAdminId: adminId, fromAdminId: null } },
    })
    return true
  }

  private async publishUpdated(ticket: TicketRow): Promise<void> {
    const adminIds = await getCommunityAdminIds(this.db, ticket.communityId)
    await Promise.all([
      publishTicketEvent({
        userIds: [ticket.userId],
        event: 'ticket.updated',
        ticketId: ticket.id,
        communityId: ticket.communityId,
        data: { ticket: ticketSummary(ticket, 'user') },
      }),
      publishTicketEvent({
        userIds: adminIds,
        event: 'ticket.updated',
        ticketId: ticket.id,
        communityId: ticket.communityId,
        data: { ticket: ticketSummary(ticket, 'admin') },
      }),
    ])
  }

  private resolvedError(): ConflictError {
    return new ConflictError('This ticket is resolved and the chat is closed', 'TICKET_RESOLVED')
  }
}
