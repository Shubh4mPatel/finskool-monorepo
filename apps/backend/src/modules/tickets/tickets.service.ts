import type { PrismaClient } from '../../generated/prisma/client.js'
import { getCommunityAdminIds } from '../../lib/community-access.js'
import { publishTicketEvent } from '../../lib/live-tickets-feed.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import type {
  TicketCommunityOptionDTO,
  TicketListPage,
  TicketMessageDTO,
  TicketUploadUrlDTO,
  UserTicketDTO,
} from './tickets.dto.js'
import type { CreateTicketDTO, ListMessagesQuery, ListTicketsQuery, PresignDTO, RatingDTO, SendMessageDTO } from './tickets.validator.js'
import {
  createUploadUrl,
  decodeCursor,
  encodeCursor,
  freshAttachmentUrl,
  isUniqueViolation,
  mapMessage,
  mapUserTicket,
  messageInclude,
  resolveAttachments,
  ticketInclude,
  ticketSummary,
} from './tickets.shared.js'

/**
 * The ticket owner's side (mobile app). Every query is scoped to `userId`, and a
 * ticket that isn't theirs is reported as 404 — never 403 — so ids can't be probed.
 */
export class TicketsService {
  constructor(private readonly db: PrismaClient) {}

  // Communities the user can raise a ticket against: any they hold (or ever held) a
  // subscription for, free community included — a lapsed renewal is a valid ticket.
  async listCommunityOptions(userId: string): Promise<TicketCommunityOptionDTO[]> {
    const rows = await this.db.community.findMany({
      where: { deletedAt: null, subscriptions: { some: { userId } } },
      select: { id: true, name: true, isFree: true },
      orderBy: { name: 'asc' },
    })
    return rows
  }

  createUploadUrl(userId: string, dto: PresignDTO): Promise<TicketUploadUrlDTO> {
    return createUploadUrl(userId, dto)
  }

  async create(userId: string, clientRequestId: string, dto: CreateTicketDTO): Promise<UserTicketDTO> {
    // Fast path for a retry / double-tap: the first request already won.
    const existing = await this.findByRequestId(userId, clientRequestId)
    if (existing) return mapUserTicket(existing)

    const user = await this.db.user.findUnique({ where: { id: userId }, select: { status: true, deletedAt: true } })
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new ForbiddenError('Your account cannot raise tickets', 'ACCOUNT_INACTIVE')
    }

    const eligible = await this.db.community.findFirst({
      where: { id: dto.communityId, deletedAt: null, subscriptions: { some: { userId } } },
      select: { id: true },
    })
    if (!eligible) throw new BadRequestError('Choose one of your communities', 'COMMUNITY_NOT_ALLOWED')

    const attachments = await resolveAttachments(userId, dto.attachments)

    let ticketId: string
    try {
      const created = await this.db.$transaction(async tx => {
        const ticket = await tx.ticket.create({
          data: {
            userId,
            communityId: dto.communityId,
            category: dto.category,
            type: dto.type,
            subject: dto.subject,
            description: dto.description,
            clientRequestId,
            // The new ticket is unread for the support team until someone opens it.
            adminUnreadCount: 1,
            attachments: { create: attachments },
          },
          select: { id: true },
        })
        await tx.ticketEvent.create({ data: { ticketId: ticket.id, type: 'created', actorId: userId } })
        return ticket
      })
      ticketId = created.id
    } catch (err) {
      // Two concurrent identical submits: the loser hits the unique key — hand back the winner's ticket.
      if (isUniqueViolation(err)) {
        const winner = await this.findByRequestId(userId, clientRequestId)
        if (winner) return mapUserTicket(winner)
      }
      throw err
    }

    const ticket = await this.db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: ticketInclude })
    const adminIds = await getCommunityAdminIds(this.db, ticket.communityId)
    await Promise.all([
      publishTicketEvent({
        userIds: adminIds,
        event: 'ticket.created',
        ticketId,
        communityId: ticket.communityId,
        data: { ticket: ticketSummary(ticket, 'admin') },
      }),
      publishTicketEvent({
        userIds: [userId],
        event: 'ticket.created',
        ticketId,
        communityId: ticket.communityId,
        data: { ticket: ticketSummary(ticket, 'user') },
      }),
    ])
    return mapUserTicket(ticket)
  }

  async list(userId: string, query: ListTicketsQuery): Promise<TicketListPage<UserTicketDTO>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.db.ticket.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? { OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      include: ticketInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page[page.length - 1]
    return {
      items: await Promise.all(page.map(mapUserTicket)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    }
  }

  /** Total unread across all of the user's tickets — the app's badge. */
  async unreadTotal(userId: string): Promise<{ unreadCount: number }> {
    const agg = await this.db.ticket.aggregate({ where: { userId }, _sum: { userUnreadCount: true } })
    return { unreadCount: agg._sum.userUnreadCount ?? 0 }
  }

  async get(userId: string, ticketId: string): Promise<UserTicketDTO> {
    return mapUserTicket(await this.getOwned(userId, ticketId))
  }

  async listMessages(
    userId: string,
    ticketId: string,
    query: ListMessagesQuery,
  ): Promise<TicketListPage<TicketMessageDTO>> {
    await this.getOwned(userId, ticketId)
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

  async sendMessage(userId: string, ticketId: string, dto: SendMessageDTO): Promise<TicketMessageDTO> {
    const ticket = await this.getOwned(userId, ticketId)
    if (ticket.status === 'resolved') throw this.resolvedError()

    const replay = await this.findMessageByClientId(ticketId, dto.clientMessageId)
    if (replay) return mapMessage(replay)

    const attachments = await resolveAttachments(userId, dto.attachments)

    let messageId: string
    try {
      messageId = await this.db.$transaction(async tx => {
        // Conditional on "not resolved": a resolve that lands between the check above and
        // here makes this match zero rows, so no message can slip into a closed ticket.
        const bumped = await tx.ticket.updateMany({
          where: { id: ticketId, userId, status: { not: 'resolved' } },
          data: { lastMessageAt: new Date(), adminUnreadCount: { increment: 1 } },
        })
        if (bumped.count === 0) throw this.resolvedError()
        const message = await tx.ticketMessage.create({
          data: {
            ticketId,
            senderId: userId,
            senderRole: 'user',
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
        const winner = await this.findMessageByClientId(ticketId, dto.clientMessageId)
        if (winner) return mapMessage(winner)
      }
      throw err
    }

    const [message, fresh] = await Promise.all([
      this.db.ticketMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude }),
      this.db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: ticketInclude }),
    ])
    const dtoMessage = await mapMessage(message)
    const adminIds = await getCommunityAdminIds(this.db, fresh.communityId)
    await Promise.all([
      publishTicketEvent({
        userIds: adminIds,
        event: 'ticket.message',
        ticketId,
        communityId: fresh.communityId,
        data: { message: dtoMessage, ticket: ticketSummary(fresh, 'admin') },
      }),
      publishTicketEvent({
        userIds: [userId],
        event: 'ticket.message',
        ticketId,
        communityId: fresh.communityId,
        data: { message: dtoMessage, ticket: ticketSummary(fresh, 'user') },
      }),
    ])
    return dtoMessage
  }

  async markRead(userId: string, ticketId: string): Promise<{ unreadCount: number }> {
    const ticket = await this.getOwned(userId, ticketId)
    if (ticket.userUnreadCount > 0) {
      await this.db.ticket.update({ where: { id: ticketId }, data: { userUnreadCount: 0 } })
      // Other devices of the same user clear their badge too.
      await publishTicketEvent({
        userIds: [userId],
        event: 'ticket.read',
        ticketId,
        communityId: ticket.communityId,
        data: { unreadCount: 0 },
      })
    }
    return { unreadCount: 0 }
  }

  async rate(userId: string, ticketId: string, dto: RatingDTO): Promise<UserTicketDTO> {
    // The conditional update is the lock: only a resolved, not-yet-rated ticket of this
    // user matches, so two racing submits can't both write a rating.
    const rated = await this.db.ticket.updateMany({
      where: { id: ticketId, userId, status: 'resolved', rating: null },
      data: { rating: dto.rating, ratingComment: dto.comment || null, ratedAt: new Date() },
    })
    const ticket = await this.getOwned(userId, ticketId)
    if (rated.count === 0) {
      if (ticket.status !== 'resolved') {
        throw new ConflictError('You can rate a ticket once it is resolved', 'TICKET_NOT_RESOLVED')
      }
      throw new ConflictError('This ticket has already been rated', 'ALREADY_RATED')
    }

    const adminIds = await getCommunityAdminIds(this.db, ticket.communityId)
    await publishTicketEvent({
      userIds: adminIds,
      event: 'ticket.updated',
      ticketId,
      communityId: ticket.communityId,
      data: { ticket: ticketSummary(ticket, 'admin') },
    })
    return mapUserTicket(ticket)
  }

  /** Fresh presigned link for an attachment whose earlier one expired. */
  async getAttachmentUrl(userId: string, ticketId: string, attachmentId: string): Promise<{ url: string }> {
    await this.getOwned(userId, ticketId)
    const attachment = await this.db.ticketAttachment.findFirst({ where: { id: attachmentId, ticketId } })
    if (!attachment) throw new NotFoundError('Attachment not found')
    return { url: await freshAttachmentUrl(attachment) }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async getOwned(userId: string, ticketId: string) {
    const ticket = await this.db.ticket.findFirst({ where: { id: ticketId, userId }, include: ticketInclude })
    if (!ticket) throw new NotFoundError('Ticket not found')
    return ticket
  }

  private findByRequestId(userId: string, clientRequestId: string) {
    return this.db.ticket.findUnique({
      where: { uq_tickets_user_request: { userId, clientRequestId } },
      include: ticketInclude,
    })
  }

  private findMessageByClientId(ticketId: string, clientMessageId: string) {
    return this.db.ticketMessage.findUnique({
      where: { uq_ticket_messages_client_id: { ticketId, clientMessageId } },
      include: messageInclude,
    })
  }

  private resolvedError(): ConflictError {
    return new ConflictError('This ticket is resolved and the chat is closed', 'TICKET_RESOLVED')
  }
}
