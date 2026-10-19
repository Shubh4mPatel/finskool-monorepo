import type { PrismaClient } from '../../generated/prisma/client.js'
import { getAllAdminIds } from '../../lib/community-access.js'
import { publishServiceEvent } from '../../lib/live-tickets-feed.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import { createUploadUrl } from '../tickets/tickets.shared.js'
import type { TicketUploadUrlDTO } from '../tickets/tickets.dto.js'
import type {
  ListPage,
  MemberServiceDTO,
  MemberServiceRequestDTO,
  ServiceMessageDTO,
} from './services.dto.js'
import type {
  CreateServiceRequestDTO,
  ListMessagesQuery,
  ListServiceRequestsQuery,
  PresignDTO,
  RatingDTO,
  SendMessageDTO,
} from './services.validator.js'
import {
  decodeCursor,
  encodeCursor,
  freshAttachmentUrl,
  isUniqueViolation,
  mapMemberRequest,
  mapMemberService,
  mapMessage,
  messageInclude,
  requestInclude,
  requestSummary,
  resolveAttachments,
} from './services.shared.js'

/**
 * The requesting member's side (mobile app). Every query is scoped to `userId`, and a request
 * that isn't theirs is reported as 404 — never 403 — so ids can't be probed.
 */
export class ServicesService {
  constructor(private readonly db: PrismaClient) {}

  /** Services a member can request: every active one (the catalog is global). */
  async listCatalog(): Promise<MemberServiceDTO[]> {
    const rows = await this.db.service.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    })
    return rows.map(mapMemberService)
  }

  createUploadUrl(userId: string, dto: PresignDTO): Promise<TicketUploadUrlDTO> {
    return createUploadUrl(userId, dto, 'services')
  }

  async create(userId: string, clientRequestId: string, dto: CreateServiceRequestDTO): Promise<MemberServiceRequestDTO> {
    // Fast path for a retry / double-tap: the first request already won.
    const existing = await this.findByClientRequestId(userId, clientRequestId)
    if (existing) return mapMemberRequest(existing)

    const user = await this.db.user.findUnique({ where: { id: userId }, select: { status: true, deletedAt: true } })
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new ForbiddenError('Your account cannot request services', 'ACCOUNT_INACTIVE')
    }

    const service = await this.db.service.findFirst({
      where: { id: dto.serviceId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (!service) throw new NotFoundError('Service not found')

    if (await this.hasOpenRequest(userId, service.id)) throw this.alreadyOpenError()

    const attachments = await resolveAttachments(userId, dto.attachments, 'services')

    let requestId: string
    try {
      requestId = await this.db.$transaction(async tx => {
        const request = await tx.serviceRequest.create({
          data: {
            userId,
            serviceId: service.id,
            needs: dto.needs,
            clientRequestId,
            // The new request is unread for the support team until someone opens it.
            adminUnreadCount: 1,
            attachments: { create: attachments },
          },
          select: { id: true },
        })
        await tx.serviceEvent.create({ data: { requestId: request.id, type: 'created', actorId: userId } })
        return request.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Two concurrent identical submits: the loser hits the unique key — hand back the winner's request.
        const winner = await this.findByClientRequestId(userId, clientRequestId)
        if (winner) return mapMemberRequest(winner)
        // Otherwise it was the "one open request per service" rule (a racing request with another key).
        throw this.alreadyOpenError()
      }
      throw err
    }

    const request = await this.db.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude })
    const adminIds = await getAllAdminIds(this.db)
    await Promise.all([
      publishServiceEvent({
        userIds: adminIds,
        event: 'service.created',
        requestId,
        data: { request: requestSummary(request, 'admin') },
      }),
      publishServiceEvent({
        userIds: [userId],
        event: 'service.created',
        requestId,
        data: { request: requestSummary(request, 'member') },
      }),
    ])
    return mapMemberRequest(request)
  }

  async list(userId: string, query: ListServiceRequestsQuery): Promise<ListPage<MemberServiceRequestDTO>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.db.serviceRequest.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? { OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      include: requestInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page[page.length - 1]
    return {
      items: await Promise.all(page.map(mapMemberRequest)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    }
  }

  /** Total unread across all of the member's requests — the app's badge. */
  async unreadTotal(userId: string): Promise<{ unreadCount: number }> {
    const agg = await this.db.serviceRequest.aggregate({ where: { userId }, _sum: { userUnreadCount: true } })
    return { unreadCount: agg._sum.userUnreadCount ?? 0 }
  }

  async get(userId: string, requestId: string): Promise<MemberServiceRequestDTO> {
    return mapMemberRequest(await this.getOwned(userId, requestId))
  }

  async listMessages(
    userId: string,
    requestId: string,
    query: ListMessagesQuery,
  ): Promise<ListPage<ServiceMessageDTO>> {
    await this.getOwned(userId, requestId)
    const cursor = query.before ? decodeCursor(query.before) : null
    const rows = await this.db.serviceMessage.findMany({
      where: {
        requestId,
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

  async sendMessage(userId: string, requestId: string, dto: SendMessageDTO): Promise<ServiceMessageDTO> {
    const request = await this.getOwned(userId, requestId)

    // Before the closed check: a retry of a message that was already stored (its ack got lost and
    // the request was closed meanwhile) must get that message back, not a "chat closed" error.
    const replay = await this.findMessageByClientId(requestId, dto.clientMessageId)
    if (replay) return mapMessage(replay)
    if (request.status === 'closed') throw this.closedError()

    const attachments = await resolveAttachments(userId, dto.attachments, 'services')

    let messageId: string
    try {
      messageId = await this.db.$transaction(async tx => {
        // Conditional on "not closed": a close that lands between the check above and here makes
        // this match zero rows, so no message can slip into a closed request.
        const bumped = await tx.serviceRequest.updateMany({
          where: { id: requestId, userId, status: { not: 'closed' } },
          data: { lastMessageAt: new Date(), adminUnreadCount: { increment: 1 } },
        })
        if (bumped.count === 0) throw this.closedError()
        const message = await tx.serviceMessage.create({
          data: {
            requestId,
            senderId: userId,
            senderRole: 'user',
            body: dto.body || null,
            clientMessageId: dto.clientMessageId,
            attachments: { create: attachments.map(a => ({ ...a, requestId })) },
          },
          select: { id: true },
        })
        return message.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.findMessageByClientId(requestId, dto.clientMessageId)
        if (winner) return mapMessage(winner)
      }
      throw err
    }

    const [message, fresh] = await Promise.all([
      this.db.serviceMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude }),
      this.db.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude }),
    ])
    const dtoMessage = await mapMessage(message)
    const adminIds = await getAllAdminIds(this.db)
    await Promise.all([
      publishServiceEvent({
        userIds: adminIds,
        event: 'service.message',
        requestId,
        data: { message: dtoMessage, request: requestSummary(fresh, 'admin') },
      }),
      publishServiceEvent({
        userIds: [userId],
        event: 'service.message',
        requestId,
        data: { message: dtoMessage, request: requestSummary(fresh, 'member') },
      }),
    ])
    return dtoMessage
  }

  async markRead(userId: string, requestId: string): Promise<{ unreadCount: number }> {
    const request = await this.getOwned(userId, requestId)
    if (request.userUnreadCount > 0) {
      await this.db.serviceRequest.update({ where: { id: requestId }, data: { userUnreadCount: 0 } })
      // Other devices of the same member clear their badge too.
      await publishServiceEvent({
        userIds: [userId],
        event: 'service.read',
        requestId,
        data: { unreadCount: 0 },
      })
    }
    return { unreadCount: 0 }
  }

  /** Member backs out before paying. Once paid, only the support team closes the request. */
  async cancel(userId: string, requestId: string): Promise<MemberServiceRequestDTO> {
    const request = await this.getOwned(userId, requestId)
    if (request.status === 'closed') throw this.closedError()
    if (request.status === 'paid') {
      throw new ConflictError('This request is already paid — the support team will close it once the service is delivered', 'SERVICE_NOT_CANCELLABLE')
    }

    const now = new Date()
    const closed = await this.db.$transaction(async tx => {
      // The status is part of the WHERE, so a payment that lands after the read above matches zero rows.
      const updated = await tx.serviceRequest.updateMany({
        where: { id: requestId, userId, status: { in: ['requested', 'quote_sent'] } },
        data: { status: 'closed', closedReason: 'cancelled_by_member', closedAt: now },
      })
      if (updated.count === 0) return false
      await tx.serviceEvent.create({ data: { requestId, type: 'cancelled', actorId: userId } })
      return true
    })
    if (!closed) {
      const current = await this.getOwned(userId, requestId)
      if (current.status === 'paid') {
        throw new ConflictError('This request is already paid — the support team will close it once the service is delivered', 'SERVICE_NOT_CANCELLABLE')
      }
      throw this.closedError()
    }

    const fresh = await this.getOwned(userId, requestId)
    await this.publishUpdated(fresh, userId)
    return mapMemberRequest(fresh)
  }

  async rate(userId: string, requestId: string, dto: RatingDTO): Promise<MemberServiceRequestDTO> {
    // The conditional update is the lock: only a completed, not-yet-rated request of this member
    // matches, so two racing submits can't both write a rating.
    const rated = await this.db.serviceRequest.updateMany({
      where: { id: requestId, userId, status: 'closed', closedReason: 'completed', rating: null },
      data: { rating: dto.rating, ratingComment: dto.comment || null, ratedAt: new Date() },
    })
    const request = await this.getOwned(userId, requestId)
    if (rated.count === 0) {
      if (request.status !== 'closed' || request.closedReason !== 'completed') {
        throw new ConflictError('You can rate a service once it is completed', 'SERVICE_NOT_COMPLETED')
      }
      throw new ConflictError('This service has already been rated', 'ALREADY_RATED')
    }

    const adminIds = await getAllAdminIds(this.db)
    await publishServiceEvent({
      userIds: adminIds,
      event: 'service.updated',
      requestId,
      data: { request: requestSummary(request, 'admin') },
    })
    return mapMemberRequest(request)
  }

  /** Fresh presigned link for an attachment whose earlier one expired. */
  async getAttachmentUrl(userId: string, requestId: string, attachmentId: string): Promise<{ url: string }> {
    await this.getOwned(userId, requestId)
    const attachment = await this.db.serviceAttachment.findFirst({ where: { id: attachmentId, requestId } })
    if (!attachment) throw new NotFoundError('Attachment not found')
    return { url: await freshAttachmentUrl(attachment) }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async getOwned(userId: string, requestId: string) {
    const request = await this.db.serviceRequest.findFirst({ where: { id: requestId, userId }, include: requestInclude })
    if (!request) throw new NotFoundError('Service request not found')
    return request
  }

  private findByClientRequestId(userId: string, clientRequestId: string) {
    return this.db.serviceRequest.findUnique({
      where: { uq_service_requests_user_request: { userId, clientRequestId } },
      include: requestInclude,
    })
  }

  private async hasOpenRequest(userId: string, serviceId: string): Promise<boolean> {
    const open = await this.db.serviceRequest.findFirst({
      where: { userId, serviceId, status: { not: 'closed' } },
      select: { id: true },
    })
    return open !== null
  }

  private findMessageByClientId(requestId: string, clientMessageId: string) {
    return this.db.serviceMessage.findUnique({
      where: { uq_service_messages_client_id: { requestId, clientMessageId } },
      include: messageInclude,
    })
  }

  private async publishUpdated(request: Awaited<ReturnType<ServicesService['getOwned']>>, userId: string) {
    const adminIds = await getAllAdminIds(this.db)
    await Promise.all([
      publishServiceEvent({
        userIds: [userId],
        event: 'service.updated',
        requestId: request.id,
        data: { request: requestSummary(request, 'member') },
      }),
      publishServiceEvent({
        userIds: adminIds,
        event: 'service.updated',
        requestId: request.id,
        data: { request: requestSummary(request, 'admin') },
      }),
    ])
  }

  private alreadyOpenError(): ConflictError {
    return new ConflictError('You already have an open request for this service', 'SERVICE_REQUEST_ALREADY_OPEN')
  }

  private closedError(): ConflictError {
    return new ConflictError('This request is closed and the chat is locked', 'SERVICE_CLOSED')
  }
}
