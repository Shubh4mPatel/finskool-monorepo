import type { PrismaClient } from '../generated/prisma/client.js'
import { getAllAdminIds } from './community-access.js'
import { publishServiceEvent } from './live-tickets-feed.js'
import { logger } from '../shared/logger.js'
import { PAYMENT_IN_PROGRESS_WINDOW_MS, mapMessage, messageInclude, requestInclude, requestSummary } from '../modules/services/services.shared.js'

const BATCH_SIZE = 200
const EXPIRED_MESSAGE = 'This quote has expired. Ask for a new one if you still need the service.'

/**
 * Marks quotes past their expiry as `expired` and puts their request back to `requested`, so the
 * admin can send a fresh one. A quote whose payment was started in the last few minutes is left
 * alone: that member may be mid-payment, and the payment would otherwise land on an expired quote.
 */
export async function expireServiceQuotes(db: PrismaClient, now: Date = new Date()): Promise<{ expired: number }> {
  const graceCutoff = new Date(now.getTime() - PAYMENT_IN_PROGRESS_WINDOW_MS)
  const dueWhere = {
    status: 'active' as const,
    expiresAt: { lte: now },
    OR: [{ paymentStartedAt: null }, { paymentStartedAt: { lt: graceCutoff } }],
  }

  const due = await db.serviceQuote.findMany({ where: dueWhere, select: { id: true, requestId: true }, take: BATCH_SIZE })
  let expired = 0

  for (const { id, requestId } of due) {
    try {
      const messageId = await db.$transaction(async tx => {
        // Same row lock as payments, quoting, cancelling and closing: whichever got there first wins.
        await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`
        const marked = await tx.serviceQuote.updateMany({ where: { id, ...dueWhere }, data: { status: 'expired' } })
        if (marked.count === 0) return null // paid, replaced or cancelled in the meantime
        await tx.serviceRequest.updateMany({
          where: { id: requestId, status: 'quote_sent' },
          data: { status: 'requested', lastMessageAt: now, userUnreadCount: { increment: 1 }, adminUnreadCount: { increment: 1 } },
        })
        await tx.serviceEvent.create({ data: { requestId, type: 'quote_expired', meta: { quoteId: id } } })
        const message = await tx.serviceMessage.create({
          data: { requestId, senderId: null, senderRole: 'system', kind: 'system', body: EXPIRED_MESSAGE },
          select: { id: true },
        })
        return message.id
      })
      if (!messageId) continue
      expired++

      const [request, message, adminIds] = await Promise.all([
        db.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude }),
        db.serviceMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude }),
        getAllAdminIds(db),
      ])
      const dtoMessage = await mapMessage(message)
      const publishFor = (userIds: string[], side: 'member' | 'admin') =>
        Promise.all([
          publishServiceEvent({ userIds, event: 'service.message', requestId, data: { message: dtoMessage, request: requestSummary(request, side) } }),
          publishServiceEvent({ userIds, event: 'service.updated', requestId, data: { request: requestSummary(request, side) } }),
        ])
      await Promise.all([publishFor([request.userId], 'member'), publishFor(adminIds, 'admin')])
    } catch (err) {
      // One bad row must not stop the rest; the next run retries it.
      logger.error({ err, quoteId: id }, 'service-quote-expiry: failed to expire quote')
    }
  }
  return { expired }
}
