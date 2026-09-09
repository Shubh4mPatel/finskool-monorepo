import type { PrismaClient, Prisma, UserRole } from '../../generated/prisma/client.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from '../../lib/queue.js'
import type { LiveNotificationEvent } from '../../lib/queue.js'
import redis from '../../lib/redis.js'
import { NotFoundError, ForbiddenError, BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { NotificationType } from '../notifications/notifications.dto.js'
import type { ReactionTypeDTO, UpsertReactionDTO, ReactionResultDTO } from './reactions.dto.js'

export class ReactionsService {
  constructor(private readonly db: PrismaClient) {}

  // Fixed, six-row lookup — cached for the life of the process (fine per the
  // confirmed requirement that reaction types are a seed list only, never
  // admin-editable at runtime).
  private reactionTypeNameById: Map<number, string> | null = null

  private async getReactionTypeNameById(): Promise<Map<number, string>> {
    if (!this.reactionTypeNameById) {
      const types = await this.db.reactionType.findMany({ select: { id: true, name: true } })
      this.reactionTypeNameById = new Map(types.map(t => [t.id, t.name]))
    }
    return this.reactionTypeNameById
  }

  async listReactionTypes(): Promise<ReactionTypeDTO[]> {
    return this.db.reactionType.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  async upsertReaction(
    userId: string,
    userRole: UserRole,
    accessibleCommunityIds: string[] | null,
    postId: string,
    data: UpsertReactionDTO,
  ): Promise<ReactionResultDTO> {
    const post = await this.db.post.findUnique({
      where: { id: postId, deletedAt: null, status: 'published' },
      select: { id: true, communityId: true, authorId: true, title: true },
    })
    if (!post) throw new NotFoundError('Post not found or not published')

    if (userRole === 'admin') {
      assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)
    }

    if (userRole !== 'admin') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const subscription = await this.db.subscription.findFirst({
        where: { userId, communityId: post.communityId, isActive: true, validUntil: { gte: today } },
      })
      if (!subscription) throw new ForbiddenError('You must be a community member to react')
    }

    const reactionTypeNameById = await this.getReactionTypeNameById()
    const reactionTypeName = reactionTypeNameById.get(data.reactionTypeId)
    if (!reactionTypeName) throw new BadRequestError('Invalid reaction type')

    // Fetched ahead of the transaction, same pattern as comments.service.ts's
    // replyNotifyTarget — skip entirely on a self-reaction (no notification).
    const notifyAuthor = post.authorId !== userId
    const reactorName = notifyAuthor
      ? (await this.db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null
      : null
    const message = reactorName ? `${reactorName} reacted to your post "${post.title}"` : null

    const { reaction, reactionCounts } = await this.db.$transaction(async tx => {
      const reaction = await tx.reaction.upsert({
        where: { uq_reactions_post_user: { postId, userId } },
        update: { reactionTypeId: data.reactionTypeId },
        create: { postId, userId, reactionTypeId: data.reactionTypeId },
      })

      const reactionCounts = await this.recomputeReactionCounts(tx, postId, reactionTypeNameById)

      // Notification is keyed on (userId, type, sourceId) via Notification's
      // uq_notifications_user_type_source, and `reaction.id` stays the same
      // across re-reactions (it's the same row, upserted) — so this MUST be
      // an upsert, not a create, or the second reaction from the same user
      // would throw a unique-constraint violation.
      if (notifyAuthor && message) {
        await tx.notification.upsert({
          where: {
            uq_notifications_user_type_source: {
              userId: post.authorId,
              type: NotificationType.Reaction,
              sourceId: reaction.id,
            },
          },
          update: { message, isRead: false },
          create: {
            communityId: post.communityId,
            userId: post.authorId,
            type: NotificationType.Reaction,
            sourceId: reaction.id,
            title: 'New reaction on your post',
            message,
          },
        })
      }

      return { reaction, reactionCounts }
    })

    // Live push over WebSocket, after the transaction commits — mirrors
    // comments.service.ts's reply-notification publish exactly.
    if (notifyAuthor && message) {
      try {
        await redis.publish(
          NOTIFICATIONS_PUBSUB_CHANNEL,
          JSON.stringify({
            userId: post.authorId,
            type: NotificationType.Reaction,
            communityId: post.communityId,
            message,
            sourceId: reaction.id,
            postId,
          } satisfies LiveNotificationEvent),
        )
      } catch (err) {
        logger.error({ err, postId, reactionId: reaction.id }, 'reactions.upsert: failed to publish live reaction notification')
      }
    }

    logger.info({ postId, userId, reactionTypeId: data.reactionTypeId }, 'reactions.upsert: success')
    return { reactionCounts, myReaction: reactionTypeName }
  }

  async removeReaction(
    userId: string,
    userRole: UserRole,
    accessibleCommunityIds: string[] | null,
    postId: string,
  ): Promise<ReactionResultDTO> {
    const post = await this.db.post.findUnique({
      where: { id: postId, deletedAt: null, status: 'published' },
      select: { id: true, communityId: true },
    })
    if (!post) throw new NotFoundError('Post not found or not published')

    if (userRole === 'admin') {
      assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)
    }

    if (userRole !== 'admin') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const subscription = await this.db.subscription.findFirst({
        where: { userId, communityId: post.communityId, isActive: true, validUntil: { gte: today } },
      })
      if (!subscription) throw new ForbiddenError('You must be a community member to react')
    }

    const reactionTypeNameById = await this.getReactionTypeNameById()

    const reactionCounts = await this.db.$transaction(async tx => {
      // deleteMany, not delete — removing a reaction that doesn't exist is a
      // harmless no-op here, not a 404-worthy error.
      await tx.reaction.deleteMany({ where: { postId, userId } })
      return this.recomputeReactionCounts(tx, postId, reactionTypeNameById)
    })

    logger.info({ postId, userId }, 'reactions.remove: success')
    return { reactionCounts, myReaction: null }
  }

  /**
   * Recomputes Post.reactionCounts from scratch (groupBy + overwrite) rather
   * than incrementing/decrementing it in place — Postgres/Prisma has no atomic
   * "increment a key inside JSONB" primitive, so re-deriving the full count
   * set from the source-of-truth `reactions` rows on every write is
   * self-healing and can never drift. Only nonzero reaction types appear as
   * keys. Always called inside the same transaction as the row write it's
   * following.
   */
  private async recomputeReactionCounts(
    tx: Prisma.TransactionClient,
    postId: string,
    reactionTypeNameById: Map<number, string>,
  ): Promise<Record<string, number>> {
    const grouped = await tx.reaction.groupBy({
      by: ['reactionTypeId'],
      where: { postId },
      _count: { _all: true },
    })
    const counts: Record<string, number> = {}
    for (const g of grouped) {
      const name = reactionTypeNameById.get(g.reactionTypeId)
      if (name) counts[name] = g._count._all
    }
    await tx.post.update({ where: { id: postId }, data: { reactionCounts: counts } })
    return counts
  }
}
