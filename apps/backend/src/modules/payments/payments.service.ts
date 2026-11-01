import type { PrismaClient } from '../../generated/prisma/client.js'
import { enqueuePush } from '../../lib/push.js'
import { env } from '../../config/env.js'
import { getRazorpayClient, verifyPaymentSignature } from '../../lib/razorpay.js'
import { recomputeActiveSubCount } from '../../lib/community-stats.js'
import { SubscriptionSource } from '../../lib/subscription-source.js'
import { formatEmailDate } from '../../lib/email-templates.js'
import {
  notificationsQueue,
  COMMUNITY_ADDED_EMAIL_JOB,
  SUBSCRIPTION_EXTENDED_EMAIL_JOB,
  NOTIFICATIONS_PUBSUB_CHANNEL,
} from '../../lib/queue.js'
import type { LiveNotificationEvent } from '../../lib/queue.js'
import redis from '../../lib/redis.js'
import { BadRequestError, NotFoundError, ConflictError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { subscriptionRouting } from '../../lib/notification-routing.js'
import { NotificationType } from '../notifications/notifications.dto.js'
import type {
  PlanListItemDTO,
  CreatePlanOrderResultDTO,
  VerifyPlanPaymentDTO,
  VerifyPlanPaymentResultDTO,
} from './payments.dto.js'

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

// JS Date rolls Jan 31 + 1 month into Mar 3 (Feb has no 31st) — clamp back
// to the last day of the intended month instead of overflowing forward.
function addMonths(base: Date, months: number): Date {
  const result = new Date(base)
  const targetMonth = result.getMonth() + months
  result.setMonth(targetMonth)
  if (result.getMonth() !== (((targetMonth % 12) + 12) % 12)) {
    result.setDate(0)
  }
  return result
}

export class PaymentsService {
  constructor(private readonly db: PrismaClient) {}

  async listPlans(communityId: string): Promise<PlanListItemDTO[]> {
    const community = await this.db.community.findUnique({ where: { id: communityId } })
    if (!community || community.deletedAt) throw new NotFoundError('Community not found')
    if (community.isFree) return [] // the free community never has purchasable plans

    const plans = await this.db.plan.findMany({
      where: { communityId, isActive: true },
      orderBy: { durationMonths: 'asc' },
      select: { id: true, name: true, durationMonths: true, price: true },
    })
    return plans.map(p => ({ id: p.id, name: p.name, durationMonths: p.durationMonths, price: Number(p.price) }))
  }

  async createOrder(userId: string, communityId: string, planId: string): Promise<CreatePlanOrderResultDTO> {
    const community = await this.db.community.findUnique({ where: { id: communityId } })
    if (!community || community.deletedAt) throw new NotFoundError('Community not found')
    if (community.isFree) throw new BadRequestError('The free community has no purchasable plans')

    const plan = await this.db.plan.findUnique({ where: { id: planId } })
    if (!plan || !plan.isActive || plan.communityId !== communityId) {
      throw new NotFoundError('Plan not found')
    }

    const amountPaise = Math.round(Number(plan.price) * 100)
    // Razorpay rejects orders below ₹1 — a mispriced plan (e.g. an admin typo)
    // would otherwise surface as an opaque 500 from the orders.create() call below.
    if (amountPaise < 100) {
      throw new BadRequestError('This plan is priced below the minimum payable amount')
    }

    const order = await getRazorpayClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `plan_${plan.id.slice(0, 8)}_${Date.now()}`,
      notes: { userId, communityId, planId },
    })

    await this.db.planOrder.create({
      data: {
        userId,
        communityId,
        planId,
        razorpayOrderId: order.id,
        amount: plan.price,
        currency: 'INR',
        status: 'created',
      },
    })

    logger.info({ userId, communityId, planId, razorpayOrderId: order.id }, 'payments.createOrder: created')

    return {
      orderId: order.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: env.razorpay.keyId,
      planId,
      communityId,
    }
  }

  /**
   * The client's "I paid" call. The signature proves Razorpay really captured this payment for this order; a
   * bad one is rejected and leaves the order untouched — marking it failed would turn away the member's later,
   * valid call (only Razorpay's own payment.failed event says a payment failed).
   */
  async verifyPayment(userId: string, data: VerifyPlanPaymentDTO): Promise<VerifyPlanPaymentResultDTO> {
    const order = await this.db.planOrder.findUnique({ where: { razorpayOrderId: data.razorpayOrderId } })
    if (!order || order.userId !== userId) throw new NotFoundError('Order not found')

    if (!verifyPaymentSignature(data.razorpayOrderId, data.razorpayPaymentId, data.razorpaySignature)) {
      logger.error({ userId, orderId: order.id }, 'payments.verifyPayment: signature mismatch')
      throw new BadRequestError('Payment verification failed', 'PAYMENT_SIGNATURE_INVALID')
    }

    return this.settlePlanOrder(order.id, data.razorpayPaymentId)
  }

  /**
   * Grants the plan for a paid order. Shared by the client's verify call and Razorpay's webhook, which can
   * arrive in either order or both: the first one grants, the other finds the order paid with the same payment
   * and just returns the same result.
   */
  async settlePlanOrder(planOrderId: string, razorpayPaymentId: string): Promise<VerifyPlanPaymentResultDTO> {
    const order = await this.db.planOrder.findUnique({ where: { id: planOrderId } })
    if (!order) throw new NotFoundError('Order not found')
    if (order.status === 'paid') return this.resultOfPaidOrder(order, razorpayPaymentId)
    const userId = order.userId

    const [plan, community, user] = await Promise.all([
      this.db.plan.findUnique({ where: { id: order.planId } }),
      this.db.community.findUnique({ where: { id: order.communityId }, select: { name: true } }),
      this.db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    ])
    if (!plan || !community || !user) throw new NotFoundError('Plan, community, or user no longer exists')

    const now = new Date()
    const today = startOfToday()

    const granted = await this.db.$transaction(async tx => {
      // Atomic claim: the `status: 'created'` guard makes this a compare-and-
      // swap on the row. Two concurrent verify calls for the same order (a
      // client retry racing itself, say) both pass the pre-transaction checks
      // above, but Postgres serializes the two UPDATEs on this row — the
      // loser's WHERE no longer matches (status is already 'paid' by the time
      // its UPDATE runs) so it affects 0 rows and we bail instead of granting
      // a second subscription for the same payment.
      const claimed = await tx.planOrder.updateMany({
        // 'failed' too: orders marked failed by an earlier version on a bad signature are still payable.
        where: { id: order.id, status: { in: ['created', 'failed'] } },
        data: { status: 'paid', razorpayPaymentId },
      })
      if (claimed.count === 0) {
        // Lost the race to the other path (verify vs webhook) — fall through to its result below.
        return null
      }

      // Same distinction extendSubscription/updateMember's newCommunity branch draw:
      // no current active row -> brand-new grant, base date = today. An active row
      // whose validUntil hasn't passed yet -> renewal, base date = that validUntil
      // (buying early doesn't cost the remaining days). An active row that's already
      // past validUntil (sweep hasn't caught it yet) is treated like a fresh grant.
      const current = await tx.subscription.findFirst({
        where: { userId, communityId: order.communityId, isActive: true },
      })
      const isNewGrant = !current
      const base = current && current.validUntil >= today ? current.validUntil : today
      const validUntil = addMonths(base, plan.durationMonths)

      if (current) {
        await tx.subscription.update({ where: { id: current.id }, data: { isActive: false } })
      }

      const subscription = await tx.subscription.create({
        data: {
          userId,
          communityId: order.communityId,
          planId: plan.id,
          // order.amount, not plan.price — the plan's price can change between
          // order creation and this verify call, but order.amount is a snapshot
          // of what Razorpay actually charged (see createOrder). Recording the
          // live plan.price here would silently misstate what the member paid.
          payment: order.amount,
          paidOn: now,
          validUntil,
          isActive: true,
          source: SubscriptionSource.Self,
        },
      })

      await tx.planOrder.update({
        where: { id: order.id },
        data: { subscriptionId: subscription.id },
      })

      // Only a brand-new grant actually moves the count — a renewal deactivates
      // the old row and activates a new one for the same member, a wash. This
      // recompute-from-scratch call is correct (and safe) either way.
      await recomputeActiveSubCount(tx, order.communityId)

      await tx.notification.create({
        data: {
          communityId: order.communityId,
          userId,
          type: isNewGrant ? NotificationType.CommunityAdded : NotificationType.SubscriptionExtended,
          sourceId: subscription.id,
          title: isNewGrant ? `You've been added to ${community.name}` : 'Access extended',
          message: `You're active until ${formatEmailDate(validUntil)}.`,
          data: subscriptionRouting(order.communityId, isNewGrant ? 'community-added' : 'extended'),
        },
      })

      return { subscription, isNewGrant }
    })
    if (!granted) {
      const fresh = await this.db.planOrder.findUniqueOrThrow({ where: { id: order.id } })
      return this.resultOfPaidOrder(fresh, razorpayPaymentId)
    }
    const { subscription, isNewGrant } = granted

    if (user.email) {
      try {
        if (isNewGrant) {
          await notificationsQueue.add(
            COMMUNITY_ADDED_EMAIL_JOB,
            {
              toEmail: user.email,
              name: user.name,
              communityName: community.name,
              validTill: subscription.validUntil.toISOString(),
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
          )
        } else {
          await notificationsQueue.add(
            SUBSCRIPTION_EXTENDED_EMAIL_JOB,
            {
              toEmail: user.email,
              name: user.name,
              communityName: community.name,
              validTill: subscription.validUntil.toISOString(),
              amount: Number(subscription.payment),
              paidOn: (subscription.paidOn ?? now).toISOString(),
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
          )
        }
      } catch (err) {
        logger.error({ err, subscriptionId: subscription.id }, 'payments.settlePlanOrder: failed to enqueue email job')
      }
    }

    try {
      await redis.publish(
        NOTIFICATIONS_PUBSUB_CHANNEL,
        JSON.stringify({
          userId,
          type: isNewGrant ? NotificationType.CommunityAdded : NotificationType.SubscriptionExtended,
          communityId: order.communityId,
          message: `You're active until ${formatEmailDate(subscription.validUntil)}.`,
          sourceId: subscription.id,
        } satisfies LiveNotificationEvent),
      )
    } catch (err) {
      logger.error({ err, subscriptionId: subscription.id }, 'payments.settlePlanOrder: failed to publish live notification')
    }

    await enqueuePush({
      userIds: [userId],
      title: isNewGrant ? `You've been added to ${community.name}` : 'Access extended',
      body: `You're active until ${formatEmailDate(subscription.validUntil)}.`,
      data: subscriptionRouting(order.communityId, isNewGrant ? 'community-added' : 'extended'),
    })

    logger.info(
      { userId, subscriptionId: subscription.id, communityId: order.communityId, isNewGrant },
      'payments.settlePlanOrder: success',
    )

    return {
      subscriptionId: subscription.id,
      communityId: order.communityId,
      planId: plan.id,
      payment: Number(subscription.payment),
      validUntil: subscription.validUntil.toISOString().split('T')[0]!,
      isActive: subscription.isActive,
    }
  }

  /**
   * An order that is already paid answers the same call again with the same result — but only for the payment
   * that paid it. This is what lets the client's verify and the webhook race without either seeing an error.
   */
  private async resultOfPaidOrder(
    order: { id: string; communityId: string; planId: string; razorpayPaymentId: string | null; subscriptionId: string | null },
    razorpayPaymentId: string,
  ): Promise<VerifyPlanPaymentResultDTO> {
    if (order.razorpayPaymentId !== razorpayPaymentId || !order.subscriptionId) {
      throw new ConflictError('This order has already been processed', 'ORDER_ALREADY_PAID')
    }
    const subscription = await this.db.subscription.findUnique({ where: { id: order.subscriptionId } })
    if (!subscription) throw new NotFoundError('Subscription no longer exists')
    return {
      subscriptionId: subscription.id,
      communityId: order.communityId,
      planId: order.planId,
      payment: Number(subscription.payment),
      validUntil: subscription.validUntil.toISOString().split('T')[0]!,
      isActive: subscription.isActive,
    }
  }
}
