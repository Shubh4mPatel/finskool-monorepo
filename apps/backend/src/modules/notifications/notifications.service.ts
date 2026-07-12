import type { PrismaClient } from '../../generated/prisma/client.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type { CommunityPostNotificationJobPayload } from '../../lib/queue.js'
import { NotificationType } from './notifications.dto.js'
import type { ListNotificationsResponseDTO } from './notifications.dto.js'

const FAN_OUT_CHUNK_SIZE = 500

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  async listForUser(userId: string, page: number, pageSize: number): Promise<ListNotificationsResponseDTO> {
    const where = { userId }

    const [notifications, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.notification.count({ where }),
    ])

    return {
      notifications: notifications.map(n => ({
        id: n.id,
        communityId: n.communityId,
        type: n.type,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({ where: { userId, isRead: false } })
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    })
    if (result.count === 0) throw new NotFoundError('Notification not found')
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    return { count: result.count }
  }

  async fanOutCommunityPost(payload: CommunityPostNotificationJobPayload): Promise<{ created: number }> {
    const subs = await this.db.subscription.findMany({
      where: { communityId: payload.communityId, isActive: true, validUntil: { gte: startOfToday() } },
      select: { userId: true },
      distinct: ['userId'],
    })

    const recipientIds = subs.map(s => s.userId).filter(id => id !== payload.triggeredByUserId)
    if (recipientIds.length === 0) return { created: 0 }

    let created = 0
    for (let i = 0; i < recipientIds.length; i += FAN_OUT_CHUNK_SIZE) {
      const chunk = recipientIds.slice(i, i + FAN_OUT_CHUNK_SIZE)
      const result = await this.db.notification.createMany({
        data: chunk.map(userId => ({
          communityId: payload.communityId,
          userId,
          type: NotificationType.Post,
          sourceId: payload.postId,
          message: payload.message,
        })),
        skipDuplicates: true,
      })
      created += result.count
    }

    logger.info(
      { communityId: payload.communityId, postId: payload.postId, recipients: recipientIds.length, created },
      'notifications.fanOutCommunityPost: done',
    )
    return { created }
  }
}
