import { Prisma } from '../../generated/prisma/client.js'
import { notifyMemberThread, messagePreview } from '../../lib/member-notify.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { getAllAdminIds } from '../../lib/community-access.js'
import { publishServiceEvent } from '../../lib/live-tickets-feed.js'
import { generateUploadUrl } from '../../lib/minio.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import { createUploadUrl } from '../tickets/tickets.shared.js'
import type { AdminViewer } from '../tickets/tickets.shared.js'
import type { TicketUploadUrlDTO } from '../tickets/tickets.dto.js'
import type {
  AdminServiceDTO,
  AdminServiceEventDTO,
  AdminServiceRequestDetailDTO,
  AdminServiceRequestDTO,
  AdminServiceStatsDTO,
  BillingSettingsDTO,
  ListPage,
  QuoteDefaultsDTO,
  ServiceMessageDTO,
  ServicePaymentDTO,
  ServiceQuoteDTO,
} from './services.dto.js'
import type {
  AdminListServiceRequestsQuery,
  BillingSettingsInput,
  CreateCatalogServiceDTO,
  ListMessagesQuery,
  PresignDTO,
  SendMessageDTO,
  SendQuoteDTO,
  UpdateCatalogServiceDTO,
} from './services.validator.js'
import { isBillingConfigured, loadBillingSettings, mapBillingSettings, saveBillingSettings } from './billing-settings.js'
import { computeQuoteAmounts, paiseToDecimal, rupeesToPaise } from './services.billing.js'
import { getInvoiceDownloadUrl } from './services.invoice.js'
import {
  PAYMENT_IN_PROGRESS_WINDOW_MS,
  mapQuote,
  decodeCursor,
  encodeCursor,
  freshAttachmentUrl,
  isUniqueViolation,
  mapAdminRequest,
  mapAdminService,
  mapMessage,
  messageInclude,
  requestInclude,
  requestSummary,
  resolveAttachments,
} from './services.shared.js'
import type { ServiceRequestRow } from './services.shared.js'

// Prisma's `contains` doesn't escape LIKE wildcards, so "%" / "_" in a search would match everything.
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&')

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

/**
 * The support team's side (web dashboard). Services are global, so every admin can see every
 * request. Ownership works as for tickets: the first admin to claim or reply owns the request;
 * others can read but not reply or close; a super admin can always act and can reassign.
 */
export class AdminServicesService {
  constructor(private readonly db: PrismaClient) {}

  // ─── Catalog ──────────────────────────────────────────────────────────────

  async listCatalog(): Promise<AdminServiceDTO[]> {
    const [rows, open] = await Promise.all([
      this.db.service.findMany({
        where: { deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { title: 'asc' }, { id: 'asc' }],
      }),
      this.db.serviceRequest.groupBy({ by: ['serviceId'], where: { status: { not: 'closed' } }, _count: { _all: true } }),
    ])
    const openByService = new Map(open.map(o => [o.serviceId, o._count._all]))
    return rows.map(r => mapAdminService(r, openByService.get(r.id) ?? 0))
  }

  async getService(serviceId: string): Promise<AdminServiceDTO> {
    const row = await this.db.service.findFirst({ where: { id: serviceId, deletedAt: null } })
    if (!row) throw new NotFoundError('Service not found')
    const open = await this.db.serviceRequest.count({ where: { serviceId, status: { not: 'closed' } } })
    return mapAdminService(row, open)
  }

  async createService(admin: AdminViewer, dto: CreateCatalogServiceDTO): Promise<AdminServiceDTO> {
    const row = await this.db.service.create({
      data: {
        name: dto.name ?? dto.title,
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl ?? null,
        iconUrl: dto.iconUrl ?? null,
        serviceType: dto.serviceType,
        tags: dto.tags,
        highlights: dto.highlights,
        whatMembersGet: dto.whatMembersGet,
        isActive: dto.isActive,
        createdBy: admin.id,
      },
    })
    return mapAdminService(row)
  }

  async updateService(serviceId: string, dto: UpdateCatalogServiceDTO): Promise<AdminServiceDTO> {
    const existing = await this.db.service.findFirst({ where: { id: serviceId, deletedAt: null }, select: { id: true } })
    if (!existing) throw new NotFoundError('Service not found')
    // Only the fields that were sent: the project's strict optional typing rejects explicit undefineds.
    const data: Prisma.ServiceUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.title !== undefined) data.title = dto.title
    if (dto.description !== undefined) data.description = dto.description
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl
    if (dto.iconUrl !== undefined) data.iconUrl = dto.iconUrl
    if (dto.serviceType !== undefined) data.serviceType = dto.serviceType
    if (dto.tags !== undefined) data.tags = dto.tags
    if (dto.highlights !== undefined) data.highlights = dto.highlights
    if (dto.whatMembersGet !== undefined) data.whatMembersGet = dto.whatMembersGet
    if (dto.isActive !== undefined) data.isActive = dto.isActive
    const row = await this.db.service.update({ where: { id: serviceId }, data })
    const open = await this.db.serviceRequest.count({ where: { serviceId, status: { not: 'closed' } } })
    return mapAdminService(row, open)
  }

  /** Soft delete: requests already raised keep pointing at the service, new ones can't. */
  async deleteService(serviceId: string): Promise<void> {
    const deleted = await this.db.service.updateMany({
      where: { id: serviceId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    })
    if (deleted.count === 0) throw new NotFoundError('Service not found')
  }

  createCatalogImageUploadUrl(fileName: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      throw new BadRequestError('Only JPG, PNG and WebP images are allowed', 'IMAGE_INVALID')
    }
    return generateUploadUrl(fileName, 'services')
  }

  // ─── Requests ─────────────────────────────────────────────────────────────

  createUploadUrl(admin: AdminViewer, dto: PresignDTO): Promise<TicketUploadUrlDTO> {
    return createUploadUrl(admin.id, dto, 'services')
  }

  async list(admin: AdminViewer, query: AdminListServiceRequestsQuery): Promise<ListPage<AdminServiceRequestDTO>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const where: Prisma.ServiceRequestWhereInput[] = []

    if (query.status) where.push({ status: query.status })
    if (query.open === 'true') where.push({ status: { not: 'closed' } })
    if (query.serviceId) where.push({ serviceId: query.serviceId })
    if (query.userId) where.push({ userId: query.userId })
    if (query.unread === 'true') where.push({ adminUnreadCount: { gt: 0 } })
    if (query.review === 'true') where.push({ requiresReview: true })
    if (query.assignee === 'unassigned') where.push({ assignedAdminId: null })
    else if (query.assignee === 'me') where.push({ assignedAdminId: admin.id })
    else if (query.assignee) where.push({ assignedAdminId: query.assignee })
    if (query.search) {
      // "12" / "SR-12" is a request number. Digits only and capped at 9 so it always fits the
      // 32-bit column.
      const idMatch = /^(?:sr-)?(\d{1,9})$/i.exec(query.search)
      const number = idMatch ? Number(idMatch[1]) : 0
      const text = escapeLike(query.search)
      where.push({
        OR: [
          { service: { title: { contains: text, mode: 'insensitive' } } },
          { service: { name: { contains: text, mode: 'insensitive' } } },
          ...(number > 0 ? [{ number }] : []),
          { user: { name: { contains: text, mode: 'insensitive' } } },
        ],
      })
    }
    if (cursor) {
      where.push({ OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }] })
    }

    const rows = await this.db.serviceRequest.findMany({
      where: { AND: where },
      include: requestInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const last = page[page.length - 1]
    return {
      items: await Promise.all(page.map(r => mapAdminRequest(r, admin))),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    }
  }

  /** Numbers for the sidebar badge / inbox header. */
  async stats(admin: AdminViewer): Promise<AdminServiceStatsDTO> {
    const open: Prisma.ServiceRequestWhereInput = { status: { not: 'closed' } }
    const [unassigned, mine, mineUnread, requested, quoteSent, paid, closed, needsReview, ratings] = await Promise.all([
      this.db.serviceRequest.count({ where: { ...open, assignedAdminId: null } }),
      this.db.serviceRequest.count({ where: { ...open, assignedAdminId: admin.id } }),
      this.db.serviceRequest.count({ where: { ...open, assignedAdminId: admin.id, adminUnreadCount: { gt: 0 } } }),
      this.db.serviceRequest.count({ where: { status: 'requested' } }),
      this.db.serviceRequest.count({ where: { status: 'quote_sent' } }),
      this.db.serviceRequest.count({ where: { status: 'paid' } }),
      this.db.serviceRequest.count({ where: { status: 'closed' } }),
      this.db.serviceRequest.count({ where: { requiresReview: true } }),
      this.db.serviceRequest.aggregate({ where: { rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    ])
    return {
      unassigned,
      mine,
      mineUnread,
      requested,
      quoteSent,
      paid,
      closed,
      needsReview,
      averageRating: ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 10) / 10,
      ratingCount: ratings._count.rating,
    }
  }

  async get(admin: AdminViewer, requestId: string): Promise<AdminServiceRequestDetailDTO> {
    const request = await this.getRequest(requestId)
    const events = await this.db.serviceEvent.findMany({
      where: { requestId },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const toAdminId = (meta: unknown) => (meta as { toAdminId?: string } | null)?.toAdminId
    const targetIds = [...new Set(events.map(e => toAdminId(e.meta)).filter((id): id is string => typeof id === 'string'))]
    const targets = targetIds.length
      ? await this.db.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
      : []
    const targetName = new Map(targets.map(t => [t.id, t.name]))
    const quotes = await this.db.serviceQuote.findMany({ where: { requestId }, orderBy: { version: 'asc' } })
    const orders = quotes.length
      ? await this.db.razorpayOrder.findMany({
          where: { purpose: 'service_quote', referenceId: { in: quotes.map(q => q.id) } },
          include: { payments: { orderBy: { createdAt: 'asc' } } },
        })
      : []
    const payments: ServicePaymentDTO[] = orders
      .flatMap(o =>
        o.payments.map(p => ({
          id: p.id,
          quoteId: o.referenceId,
          razorpayOrderId: o.razorpayOrderId,
          razorpayPaymentId: p.razorpayPaymentId,
          amount: Number(p.amount),
          status: p.status,
          method: p.method,
          settledVia: p.settledVia,
          errorDescription: p.errorDescription,
          createdAt: p.createdAt.toISOString(),
        })),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return {
      ...(await mapAdminRequest(request, admin)),
      quotes: quotes.map(q => mapQuote(q)),
      payments,
      events: events.map(
        (e): AdminServiceEventDTO => ({
          id: e.id,
          type: e.type,
          actorId: e.actorId,
          actorName: e.actor?.name ?? null,
          targetName: targetName.get(toAdminId(e.meta) ?? '') ?? null,
          meta: e.meta,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
    }
  }

  async listMessages(requestId: string, query: ListMessagesQuery): Promise<ListPage<ServiceMessageDTO>> {
    await this.getRequest(requestId)
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

  async claim(admin: AdminViewer, requestId: string): Promise<AdminServiceRequestDTO> {
    const request = await this.getRequest(requestId)
    if (request.status === 'closed') throw this.closedError()
    if (request.assignedAdminId === admin.id) return mapAdminRequest(request, admin) // already mine — idempotent

    const claimed = await this.db.$transaction(tx => this.claimInTx(tx, requestId, admin.id))
    if (!claimed) {
      const current = await this.getRequest(requestId)
      if (current.assignedAdminId === admin.id) return mapAdminRequest(current, admin)
      throw new ConflictError('This request is already assigned to another admin', 'SERVICE_ALREADY_ASSIGNED')
    }
    const fresh = await this.getRequest(requestId)
    await this.publishUpdated(fresh)
    return mapAdminRequest(fresh, admin)
  }

  /** Super admin only: hand the request to another admin. */
  async reassign(admin: AdminViewer, requestId: string, toAdminId: string): Promise<AdminServiceRequestDTO> {
    if (!admin.isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
    const request = await this.getRequest(requestId)
    if (request.status === 'closed') throw this.closedError()
    if (request.assignedAdminId === toAdminId) return mapAdminRequest(request, admin)

    const eligible = await getAllAdminIds(this.db)
    if (!eligible.includes(toAdminId)) {
      throw new BadRequestError('That user is not an admin', 'ADMIN_NOT_ELIGIBLE')
    }

    const changed = await this.db.$transaction(async tx => {
      const updated = await tx.serviceRequest.updateMany({
        where: { id: requestId, status: { not: 'closed' } },
        data: { assignedAdminId: toAdminId },
      })
      if (updated.count === 0) return false
      await tx.serviceEvent.create({
        data: {
          requestId,
          type: request.assignedAdminId ? 'reassigned' : 'assigned',
          actorId: admin.id,
          meta: { toAdminId, fromAdminId: request.assignedAdminId },
        },
      })
      return true
    })
    if (!changed) throw this.closedError()

    const fresh = await this.getRequest(requestId)
    await this.publishUpdated(fresh)
    return mapAdminRequest(fresh, admin)
  }

  async reply(admin: AdminViewer, requestId: string, dto: SendMessageDTO): Promise<ServiceMessageDTO> {
    const request = await this.getRequest(requestId)

    // Before the closed / ownership checks: a retry of a message that was already stored (its ack
    // got lost and the request was closed or reassigned meanwhile) gets that message back.
    const replay = await this.findMessageByClientId(requestId, dto.clientMessageId)
    if (replay) return mapMessage(replay)
    if (request.status === 'closed') throw this.closedError()
    this.assertCanAct(admin, request)

    const attachments = await resolveAttachments(admin.id, dto.attachments, 'services')

    let messageId: string
    try {
      messageId = await this.db.$transaction(async tx => {
        // First reply on an unassigned request claims it. If another admin got there first, the
        // conditional claim fails and the ownership check below decides.
        if (request.assignedAdminId === null) await this.claimInTx(tx, requestId, admin.id)
        // Status and ownership are part of the WHERE, so they're re-evaluated under the row lock:
        // a close / reassign that lands after our read above matches zero rows here.
        const bumped = await tx.serviceRequest.updateMany({
          where: {
            id: requestId,
            status: { not: 'closed' },
            ...(admin.isSuperAdmin ? {} : { assignedAdminId: admin.id }),
          },
          data: { lastMessageAt: new Date(), userUnreadCount: { increment: 1 } },
        })
        if (bumped.count === 0) {
          const current = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } })
          if (current.status === 'closed') throw this.closedError()
          throw new ForbiddenError('This request is handled by another admin', 'SERVICE_ASSIGNED_TO_OTHER')
        }
        const message = await tx.serviceMessage.create({
          data: {
            requestId,
            senderId: admin.id,
            senderRole: 'admin',
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
      this.getRequest(requestId),
    ])
    const dtoMessage = await mapMessage(message)
    const adminIds = await getAllAdminIds(this.db)
    await Promise.all([
      publishServiceEvent({
        userIds: [fresh.userId],
        event: 'service.message',
        requestId,
        data: { message: dtoMessage, request: requestSummary(fresh, 'member') },
      }),
      publishServiceEvent({
        userIds: adminIds,
        event: 'service.message',
        requestId,
        data: { message: dtoMessage, request: requestSummary(fresh, 'admin') },
      }),
    ])
    await notifyMemberThread({
      db: this.db,
      userId: fresh.userId,
      kind: 'service',
      threadId: requestId,
      eventId: dtoMessage.id,
      communityId: null,
      title: 'New message about your service request',
      message: messagePreview(dtoMessage.body, dtoMessage.attachments.length),
      event: 'reply',
    })
    return dtoMessage
  }

  /**
   * Owner (or a super admin) closes the request — terminal; the chat becomes read-only. The reason
   * follows the stage: closing a paid request means the service was delivered (`completed`);
   * closing one that was never paid means it is turned down (`declined`).
   */
  async close(admin: AdminViewer, requestId: string): Promise<AdminServiceRequestDTO> {
    const request = await this.getRequest(requestId)
    if (request.status === 'closed') throw this.closedError()
    if (request.assignedAdminId === null && !admin.isSuperAdmin) {
      throw new ConflictError('Take the request before closing it', 'SERVICE_NOT_CLAIMED')
    }
    this.assertCanAct(admin, request)

    const closed = await this.db.$transaction(async tx => {
      if (request.assignedAdminId === null) await this.claimInTx(tx, requestId, admin.id)
      const owner = admin.isSuperAdmin ? {} : { assignedAdminId: admin.id }
      // Terminal: nothing is left for the support team to read, so drop the unread badge (the
      // member's own unread count is untouched — they may not have seen the last reply yet).
      const common = { status: 'closed' as const, closedAt: new Date(), adminUnreadCount: 0 }
      // Status is part of each WHERE, so the reason always matches the status at the moment of
      // closing, even if a payment lands after the read above: paid -> completed, else declined.
      let reason: 'completed' | 'declined' = 'completed'
      let updated = await tx.serviceRequest.updateMany({
        where: { id: requestId, status: 'paid', ...owner },
        data: { ...common, closedReason: 'completed' },
      })
      if (updated.count === 0) {
        reason = 'declined'
        updated = await tx.serviceRequest.updateMany({
          where: { id: requestId, status: { in: ['requested', 'quote_sent'] }, ...owner },
          data: { ...common, closedReason: 'declined' },
        })
      }
      if (updated.count === 0) return false
      // Nothing left to pay: a quote still waiting for the member is withdrawn.
      await tx.serviceQuote.updateMany({ where: { requestId, status: 'active' }, data: { status: 'cancelled' } })
      await tx.serviceEvent.create({ data: { requestId, type: 'closed', actorId: admin.id, meta: { reason } } })
      return true
    })
    if (!closed) {
      const current = await this.getRequest(requestId)
      if (current.status === 'closed') throw this.closedError()
      throw new ForbiddenError('This request is handled by another admin', 'SERVICE_ASSIGNED_TO_OTHER')
    }

    const fresh = await this.getRequest(requestId)
    await this.publishUpdated(fresh)
    await notifyMemberThread({
      db: this.db,
      userId: fresh.userId,
      kind: 'service',
      threadId: requestId,
      // Closing is terminal, so the request id identifies this event.
      eventId: requestId,
      communityId: null,
      title: fresh.closedReason === 'completed' ? 'Your service is complete' : 'Your service request was closed',
      message: fresh.closedReason === 'completed' ? 'Tap to see the details and rate it.' : 'Tap to see why.',
      event: 'closed',
    })
    return mapAdminRequest(fresh, admin)
  }

  /**
   * Zeroes the unread badge. Only the assignee clears it — an admin merely looking at someone
   * else's (or an unassigned) request must not hide it from the person who owns it.
   */
  async markRead(admin: AdminViewer, requestId: string): Promise<{ unreadCount: number }> {
    const request = await this.getRequest(requestId)
    if (request.assignedAdminId !== admin.id || request.adminUnreadCount === 0) {
      return { unreadCount: request.adminUnreadCount }
    }
    await this.db.serviceRequest.update({ where: { id: requestId }, data: { adminUnreadCount: 0 } })
    await publishServiceEvent({
      userIds: [admin.id],
      event: 'service.read',
      requestId,
      data: { unreadCount: 0 },
    })
    return { unreadCount: 0 }
  }

  // ─── Quotes ───────────────────────────────────────────────────────────────

  /**
   * Sends the member a quote: base amount + GST, valid for a number of days. It becomes the one
   * payable quote (any earlier active one is replaced and shown disabled in the chat) and moves the
   * request to `quote_sent`. Like a first reply, sending one claims an unassigned request.
   */
  async sendQuote(admin: AdminViewer, requestId: string, dto: SendQuoteDTO): Promise<{ request: AdminServiceRequestDTO; quote: ServiceQuoteDTO }> {
    const settings = await loadBillingSettings(this.db)
    if (!isBillingConfigured(settings)) {
      throw new ConflictError('Set up the billing details before sending a quote', 'BILLING_NOT_CONFIGURED')
    }

    const request = await this.getRequest(requestId)
    if (request.status === 'closed') throw this.closedError()
    if (request.status === 'paid') throw this.alreadyPaidError()
    this.assertCanAct(admin, request)

    const ratePercent = dto.gstRatePercent ?? Number(settings.defaultGstRatePercent)
    const expiryDays = dto.expiryDays ?? settings.defaultQuoteExpiryDays
    const { basePaise, gstPaise, totalPaise } = computeQuoteAmounts(rupeesToPaise(dto.baseAmount), Math.round(ratePercent * 100))
    const now = new Date()

    const outcome = await this.db.$transaction(async tx => {
      // The same row lock the payment path takes, so a payment that is settling right now either
      // finishes first (and this fails as "already paid") or waits for this to finish.
      await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`
      const fresh = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true, assignedAdminId: true } })
      if (fresh.status === 'closed') throw this.closedError()
      if (fresh.status === 'paid') throw this.alreadyPaidError()
      if (fresh.assignedAdminId === null) {
        await this.claimInTx(tx, requestId, admin.id)
      } else if (!admin.isSuperAdmin && fresh.assignedAdminId !== admin.id) {
        throw new ForbiddenError('This request is handled by another admin', 'SERVICE_ASSIGNED_TO_OTHER')
      }

      const active = await tx.serviceQuote.findFirst({ where: { requestId, status: 'active' } })
      if (active) {
        const started = active.paymentStartedAt?.getTime() ?? 0
        if (!dto.confirmReplace && now.getTime() - started < PAYMENT_IN_PROGRESS_WINDOW_MS) {
          throw new ConflictError(
            'The member started paying the current quote a few minutes ago. Replacing it now could leave them with a payment that cannot be matched — confirm to replace it anyway.',
            'QUOTE_PAYMENT_IN_PROGRESS',
          )
        }
        await tx.serviceQuote.update({ where: { id: active.id }, data: { status: 'superseded' } })
        await tx.serviceEvent.create({ data: { requestId, type: 'quote_superseded', actorId: admin.id, meta: { quoteId: active.id, version: active.version } } })
      }

      const latest = await tx.serviceQuote.aggregate({ where: { requestId }, _max: { version: true } })
      const quote = await tx.serviceQuote.create({
        data: {
          requestId,
          version: (latest._max.version ?? 0) + 1,
          baseAmount: paiseToDecimal(basePaise),
          gstRatePercent: ratePercent.toFixed(2),
          gstAmount: paiseToDecimal(gstPaise),
          totalAmount: paiseToDecimal(totalPaise),
          note: dto.note || null,
          expiresAt: new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000),
          createdBy: admin.id,
        },
      })
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'quote_sent', lastMessageAt: now, userUnreadCount: { increment: 1 } },
      })
      const message = await tx.serviceMessage.create({
        data: { requestId, senderId: admin.id, senderRole: 'admin', kind: 'quote', quoteId: quote.id },
        select: { id: true },
      })
      await tx.serviceEvent.create({
        data: { requestId, type: 'quote_sent', actorId: admin.id, meta: { quoteId: quote.id, version: quote.version, totalAmount: Number(quote.totalAmount) } },
      })
      return { quoteId: quote.id, messageId: message.id, supersededQuoteId: active?.id ?? null }
    })

    const [message, fresh] = await Promise.all([
      this.db.serviceMessage.findUniqueOrThrow({ where: { id: outcome.messageId }, include: messageInclude }),
      this.getRequest(requestId),
    ])
    const dtoMessage = await mapMessage(message)
    const adminIds = await getAllAdminIds(this.db)
    const publishFor = (userIds: string[], side: 'member' | 'admin') =>
      publishServiceEvent({
        userIds,
        event: 'service.message',
        requestId,
        // `supersededQuoteId` tells open chats to grey out the card this one replaced.
        data: { message: dtoMessage, request: requestSummary(fresh, side), supersededQuoteId: outcome.supersededQuoteId },
      })
    await Promise.all([publishFor([fresh.userId], 'member'), publishFor(adminIds, 'admin')])
    await notifyMemberThread({
      db: this.db,
      userId: fresh.userId,
      kind: 'service',
      threadId: requestId,
      eventId: outcome.quoteId,
      communityId: null,
      title: outcome.supersededQuoteId ? 'Your quote was updated' : 'Your quote is ready',
      message: 'Open your service request to review it and pay.',
      event: 'quote',
    })
    return { request: await mapAdminRequest(fresh, admin), quote: dtoMessage.quote! }
  }

  /** The admin has paid the money back by hand (or otherwise dealt with it): clear the "needs review" flag. */
  async resolveReview(admin: AdminViewer, requestId: string): Promise<AdminServiceRequestDTO> {
    const request = await this.getRequest(requestId)
    if (!request.requiresReview) return mapAdminRequest(request, admin)
    const cleared = await this.db.$transaction(async tx => {
      const updated = await tx.serviceRequest.updateMany({ where: { id: requestId, requiresReview: true }, data: { requiresReview: false } })
      if (updated.count === 0) return false
      await tx.serviceEvent.create({ data: { requestId, type: 'review_resolved', actorId: admin.id } })
      return true
    })
    const fresh = await this.getRequest(requestId)
    if (cleared) await this.publishUpdated(fresh)
    return mapAdminRequest(fresh, admin)
  }

  async getInvoiceUrl(requestId: string): Promise<{ url: string; fileName: string }> {
    const request = await this.getRequest(requestId)
    if (!request.invoice) throw new NotFoundError('No invoice for this request yet')
    return getInvoiceDownloadUrl(this.db, request.invoice.id)
  }

  // ─── Billing settings ─────────────────────────────────────────────────────

  async getBillingSettings(admin: AdminViewer): Promise<BillingSettingsDTO> {
    this.assertSuperAdmin(admin)
    return mapBillingSettings(await loadBillingSettings(this.db))
  }

  async updateBillingSettings(admin: AdminViewer, input: BillingSettingsInput): Promise<BillingSettingsDTO> {
    this.assertSuperAdmin(admin)
    return saveBillingSettings(this.db, admin.id, input)
  }

  /** What the send-quote form pre-fills, and whether quotes can be sent at all yet. */
  async quoteDefaults(): Promise<QuoteDefaultsDTO> {
    const settings = await loadBillingSettings(this.db)
    return {
      configured: isBillingConfigured(settings),
      defaultGstRatePercent: Number(settings.defaultGstRatePercent),
      defaultQuoteExpiryDays: settings.defaultQuoteExpiryDays,
    }
  }

  async getAttachmentUrl(requestId: string, attachmentId: string): Promise<{ url: string }> {
    await this.getRequest(requestId)
    const attachment = await this.db.serviceAttachment.findFirst({ where: { id: attachmentId, requestId } })
    if (!attachment) throw new NotFoundError('Attachment not found')
    return { url: await freshAttachmentUrl(attachment) }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async getRequest(requestId: string): Promise<ServiceRequestRow> {
    const request = await this.db.serviceRequest.findUnique({ where: { id: requestId }, include: requestInclude })
    if (!request) throw new NotFoundError('Service request not found')
    return request
  }

  private findMessageByClientId(requestId: string, clientMessageId: string) {
    return this.db.serviceMessage.findUnique({
      where: { uq_service_messages_client_id: { requestId, clientMessageId } },
      include: messageInclude,
    })
  }

  // Other admins may look, but only the assignee / a super admin may act. Unassigned = any admin.
  private assertCanAct(admin: AdminViewer, request: ServiceRequestRow): void {
    if (admin.isSuperAdmin || request.assignedAdminId === null || request.assignedAdminId === admin.id) return
    throw new ForbiddenError('This request is handled by another admin', 'SERVICE_ASSIGNED_TO_OTHER')
  }

  /** Atomic "assign if still unassigned and open". Returns whether this call won the claim. */
  private async claimInTx(tx: Prisma.TransactionClient, requestId: string, adminId: string): Promise<boolean> {
    const claimed = await tx.serviceRequest.updateMany({
      where: { id: requestId, assignedAdminId: null, status: { not: 'closed' } },
      data: { assignedAdminId: adminId },
    })
    if (claimed.count === 0) return false
    await tx.serviceEvent.create({
      data: { requestId, type: 'assigned', actorId: adminId, meta: { toAdminId: adminId, fromAdminId: null } },
    })
    return true
  }

  private async publishUpdated(request: ServiceRequestRow): Promise<void> {
    const adminIds = await getAllAdminIds(this.db)
    await Promise.all([
      publishServiceEvent({
        userIds: [request.userId],
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

  private assertSuperAdmin(admin: AdminViewer): void {
    if (!admin.isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
  }

  private alreadyPaidError(): ConflictError {
    return new ConflictError('This request is already paid', 'SERVICE_ALREADY_PAID')
  }

  private closedError(): ConflictError {
    return new ConflictError('This request is closed and the chat is locked', 'SERVICE_CLOSED')
  }
}
