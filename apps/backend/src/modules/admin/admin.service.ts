import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js'
import { assertSuperAdmin, assertCommunityAccessFromToken, getCommunityAdminIds } from '../../lib/community-access.js'
import { generateUploadUrl } from '../../lib/minio.js'
import {
  notificationsQueue,
  WELCOME_EMAIL_JOB,
  SUBSCRIPTION_EXTENDED_EMAIL_JOB,
  COMMUNITY_ADDED_EMAIL_JOB,
  COMMUNITY_ACCESS_REMOVED_EMAIL_JOB,
  MEMBER_SUSPENDED_EMAIL_JOB,
  MEMBER_REINSTATED_EMAIL_JOB,
  NOTIFICATIONS_PUBSUB_CHANNEL,
} from '../../lib/queue.js'
import type { LiveNotificationEvent } from '../../lib/queue.js'
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { normalizePhone } from '../../lib/phone.js'
import { formatEmailDate } from '../../lib/email-templates.js'
import { NotificationType } from '../notifications/notifications.dto.js'
import redis from '../../lib/redis.js'
import type {
  DuplicateStrategy,
  ImportSummaryDTO,
  ImportRowDTO,
  CommentNotificationItemDTO,
  CommentNotificationListDTO,
  MarkAllRepliedDTO,
  PostThreadSummaryDTO,
  AddMemberDTO,
  AddMemberResultDTO,
  ExtendSubscriptionDTO,
  ExtendSubscriptionResultDTO,
  DeleteMemberResultDTO,
  BulkDeleteMembersResultDTO,
  SuspendMemberResultDTO,
  RevokeSuspensionResultDTO,
  CommunityDTO,
  CreateCommunityDTO,
  UpdateCommunityDTO,
  AdminUserDTO,
  CreateAdminDTO,
  UpdateAdminAccessDTO,
  MemberListFilters,
  MemberExportFilters,
  MemberListDTO,
  MemberItemDTO,
  MemberSubscriptionDTO,
  MemberStatus,
  UpdateMemberDTO,
  DashboardDTO,
  ValidateImportRowInput,
  ValidateImportRowResult,
  ValidateImportDTO,
} from './admin.dto.js'

const _require = createRequire(import.meta.url)
const XLSX = _require('xlsx') as {
  read(data: Buffer, opts: object): { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json<T>(ws: unknown, opts?: object): T[] }
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}


function parseDate(raw: string): Date | null {
  if (!raw.trim()) return null
  const d = new Date(raw.trim())
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null
  return d
}

export class AdminService {
  constructor(private readonly db: PrismaClient) {}

  async importUsers(
    buffer: Buffer,
    adminId: string,
    strategy: DuplicateStrategy,
  ): Promise<ImportSummaryDTO> {
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })

    // SheetNames[0] is string | undefined with noUncheckedIndexedAccess
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) throw new BadRequestError('The uploaded file contains no sheets')
    const sheet = workbook.Sheets[sheetName]

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    // normalize header keys (trim whitespace — CSV has "Valid " with trailing space)
    const rows: Record<string, string>[] = rawRows.map(rawRow =>
      Object.fromEntries(
        Object.entries(rawRow).map(([k, v]) => [k.trim(), String(v ?? '').trim()]),
      ),
    )

    const summary: ImportSummaryDTO = {
      total: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    const communities = await this.db.community.findMany({
      select: { id: true, name: true },
    })
    let notifyCommunityId: string | null = null

    // use entries() so we get index + element without noUncheckedIndexedAccess issues
    for (const [i, row] of rows.entries()) {
      const rowNum = i + 2 // +1 for header, +1 for 1-based index

      const rawPhone = row['Contact Number'] ?? ''
      const phone = normalizePhone(rawPhone)
      if (!phone) {
        summary.errors.push({ row: rowNum, phone: rawPhone, reason: 'Invalid phone number' })
        continue
      }

      const rawService = row['Service'] ?? ''
      // exact case-insensitive match — ambiguous values flagged as errors
      const community = communities.find(
        c => c.name.toLowerCase() === rawService.toLowerCase(),
      )
      if (!community) {
        summary.errors.push({
          row: rowNum,
          phone,
          reason: `No community matched "${rawService}" — fix the CSV and re-import`,
        })
        continue
      }

      const rawPayment = (row['Payment'] ?? '').replace(/[^0-9.]/g, '')
      const payment = parseFloat(rawPayment)
      if (isNaN(payment) || payment <= 0) {
        summary.errors.push({ row: rowNum, phone, reason: 'Invalid payment amount' })
        continue
      }

      const validUntil = parseDate(row['Valid'] ?? '')
      if (!validUntil) {
        summary.errors.push({ row: rowNum, phone, reason: 'Invalid or missing valid-until date' })
        continue
      }

      const paidOn = parseDate(row['Paid on'] ?? '') // nullable — "9 June" without year → null
      const name = row['Name'] ?? ''
      const email = (row['Email'] ?? '').toLowerCase()

      const existingUser = await this.db.user.findUnique({ where: { phone } })
      const existingAp = await this.db.approvedPhone.findUnique({ where: { phone } })

      // A user can have multiple historical subscription rows per community (renewals) —
      // only the current active one is relevant for import skip/overwrite
      const existingSub = existingUser
        ? await this.db.subscription.findFirst({
            where: { userId: existingUser.id, communityId: community.id, isActive: true },
          })
        : null

      if (existingSub) {
        // This (user + community) combo has an active subscription — skip or overwrite based on strategy
        if (strategy === 'skip') {
          summary.skipped++
          continue
        }
        // overwrite: update subscription dates; update user info only if not yet registered
        await this.db.$transaction(async tx => {
          await tx.subscription.update({
            where: { id: existingSub.id },
            data: { payment, paidOn, validUntil },
          })
          if (existingUser && !existingUser.passwordHash) {
            await tx.user.update({ where: { id: existingUser.id }, data: { name, email } })
          }
          if (existingAp) {
            await tx.approvedPhone.update({ where: { phone }, data: { name, email, addedBy: adminId } })
          }
        })
        summary.updated++
        if (!notifyCommunityId) notifyCommunityId = community.id
      } else if (existingUser && existingAp && !existingAp.isActive) {
        // A previously-deleted member coming back — revive them (overwrite name/email,
        // reset registration state) rather than just quietly re-subscribing a dead account.
        await this.db.$transaction(async tx => {
          await this.reviveMember(tx, existingUser, phone, name, email, adminId)
          await tx.subscription.create({
            data: { userId: existingUser.id, approvedPhoneId: existingAp.id, communityId: community.id, payment, paidOn, validUntil },
          })
        })
        summary.created++
        if (!notifyCommunityId) notifyCommunityId = community.id

        try {
          await notificationsQueue.add(
            WELCOME_EMAIL_JOB,
            { toEmail: email, name, phone, communityName: community.name, validTill: validUntil.toISOString() },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
          )
        } catch (err) {
          logger.error({ err, phone }, 'admin.importUsers: failed to enqueue welcome email job')
        }
      } else if (existingUser && existingAp) {
        // User exists but NOT subscribed to this community yet — add subscription only
        await this.db.subscription.create({
          data: {
            userId: existingUser.id,
            approvedPhoneId: existingAp.id,
            communityId: community.id,
            payment,
            paidOn,
            validUntil,
          },
        })
        summary.created++
        if (!notifyCommunityId) notifyCommunityId = community.id
      } else {
        // Brand new user — create User + ApprovedPhone + Subscription in one transaction
        await this.db.$transaction(async tx => {
          const user = await tx.user.create({ data: { phone, name, email } })
          const ap = await tx.approvedPhone.create({ data: { phone, name, email, addedBy: adminId } })
          await tx.subscription.create({
            data: { userId: user.id, approvedPhoneId: ap.id, communityId: community.id, payment, paidOn, validUntil },
          })
        })
        summary.created++
        if (!notifyCommunityId) notifyCommunityId = community.id

        try {
          await notificationsQueue.add(
            WELCOME_EMAIL_JOB,
            { toEmail: email, name, phone, communityName: community.name, validTill: validUntil.toISOString() },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
          )
        } catch (err) {
          logger.error({ err, phone }, 'admin.importUsers: failed to enqueue welcome email job')
        }
      }
    }

    const targetCommunityId = notifyCommunityId ?? communities[0]?.id ?? null
    if (targetCommunityId) {
      await this.notifyImportComplete(adminId, targetCommunityId, summary)
    } else {
      logger.warn({ adminId }, 'admin.importUsers: no community available for import-complete notification — skipped')
    }

    logger.info(summary, 'admin.importUsers: complete')
    return summary
  }

  async importUsersFromJSON(
    rows: ImportRowDTO[],
    adminId: string,
    strategy: DuplicateStrategy,
  ): Promise<ImportSummaryDTO> {
    const summary: ImportSummaryDTO = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] }

    const communities = await this.db.community.findMany({ select: { id: true, name: true } })
    let notifyCommunityId: string | null = null

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 1
      const rawPhone = normalizePhone(row.phone)
      if (!rawPhone) { summary.errors.push({ row: rowNum, phone: row.phone, reason: 'Invalid phone' }); continue }
      const phone: string = rawPhone
      const community = communities.find(c => c.name.toLowerCase() === row.service.toLowerCase())
      if (!community) {
        summary.errors.push({ row: rowNum, phone, reason: `Community "${row.service}" not found` })
        continue
      }
      const payment = row.payment
      const validUntil = new Date(row.valid)
      const paidOn = row.paidOn ? new Date(row.paidOn) : null

      if (isNaN(validUntil.getTime())) {
        summary.errors.push({ row: rowNum, phone, reason: 'Invalid valid-until date' })
        continue
      }

      try {
        const existingUser = await this.db.user.findUnique({ where: { phone } })
        const existingAp = await this.db.approvedPhone.findUnique({ where: { phone } })
        const existingSub = existingUser
          ? await this.db.subscription.findFirst({
              where: { userId: existingUser.id, communityId: community.id, isActive: true },
            })
          : null

        if (existingSub) {
          if (strategy === 'skip') { summary.skipped++; continue }
          await this.db.$transaction(async tx => {
            await tx.subscription.update({ where: { id: existingSub.id }, data: { payment, paidOn, validUntil } })
            if (existingUser && !existingUser.passwordHash) {
              await tx.user.update({ where: { id: existingUser.id }, data: { name: row.name, email: row.email } })
            }
            if (existingAp) {
              await tx.approvedPhone.update({ where: { phone }, data: { name: row.name, email: row.email, addedBy: adminId } })
            }
          })
          summary.updated++
          if (!notifyCommunityId) notifyCommunityId = community.id
        } else if (existingUser && existingAp && !existingAp.isActive) {
          // A previously-deleted member coming back — revive them (overwrite name/email,
          // reset registration state) rather than just quietly re-subscribing a dead account.
          await this.db.$transaction(async tx => {
            await this.reviveMember(tx, existingUser, phone, row.name, row.email, adminId)
            await tx.subscription.create({
              data: { userId: existingUser.id, approvedPhoneId: existingAp.id, communityId: community.id, payment, paidOn, validUntil },
            })
          })
          summary.created++
          if (!notifyCommunityId) notifyCommunityId = community.id

          try {
            await notificationsQueue.add(
              WELCOME_EMAIL_JOB,
              { toEmail: row.email, name: row.name, phone, communityName: community.name, validTill: validUntil.toISOString() },
              { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
            )
          } catch (err) {
            logger.error({ err, phone }, 'admin.importUsersFromJSON: failed to enqueue welcome email job')
          }
        } else if (existingUser && existingAp) {
          await this.db.subscription.create({
            data: { userId: existingUser.id, approvedPhoneId: existingAp.id, communityId: community.id, payment, paidOn, validUntil },
          })
          summary.created++
          if (!notifyCommunityId) notifyCommunityId = community.id
        } else {
          await this.db.$transaction(async tx => {
            const user = await tx.user.create({ data: { phone, name: row.name, email: row.email } })
            const ap = await tx.approvedPhone.create({ data: { phone, name: row.name, email: row.email, addedBy: adminId } })
            await tx.subscription.create({
              data: { userId: user.id, approvedPhoneId: ap.id, communityId: community.id, payment, paidOn, validUntil },
            })
          })
          summary.created++
          if (!notifyCommunityId) notifyCommunityId = community.id

          try {
            await notificationsQueue.add(
              WELCOME_EMAIL_JOB,
              { toEmail: row.email, name: row.name, phone, communityName: community.name, validTill: validUntil.toISOString() },
              { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
            )
          } catch (err) {
            logger.error({ err, phone }, 'admin.importUsersFromJSON: failed to enqueue welcome email job')
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        summary.errors.push({ row: rowNum, phone, reason: msg })
      }
    }

    const targetCommunityId = notifyCommunityId ?? communities[0]?.id ?? null
    if (targetCommunityId) {
      await this.notifyImportComplete(adminId, targetCommunityId, summary)
    } else {
      logger.warn({ adminId }, 'admin.importUsersFromJSON: no community available for import-complete notification — skipped')
    }

    logger.info(summary, 'admin.importUsersFromJSON: complete')
    return summary
  }

  private async notifyImportComplete(adminId: string, communityId: string, summary: ImportSummaryDTO): Promise<void> {
    const sourceId = randomUUID()
    const message = `${summary.errors.length} rows skipped. Review the error list.`
    try {
      await this.db.notification.create({
        data: {
          communityId,
          userId: adminId,
          type: NotificationType.ImportComplete,
          sourceId,
          title: `Import complete — ${summary.created} members added`,
          message,
        },
      })
      await redis.publish(
        NOTIFICATIONS_PUBSUB_CHANNEL,
        JSON.stringify({ userId: adminId, type: NotificationType.ImportComplete, communityId, message, sourceId } satisfies LiveNotificationEvent),
      )
    } catch (err) {
      logger.error({ err, adminId }, 'admin.notifyImportComplete: failed')
    }
  }

  async listCommentNotifications(
    accessibleCommunityIds: string[] | null,
    isReplied: boolean | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<CommentNotificationListDTO> {
    const where = {
      ...(isReplied !== undefined ? { isReplied } : {}),
      ...(accessibleCommunityIds !== null ? { post: { communityId: { in: accessibleCommunityIds } } } : {}),
    }

    const rows = await this.db.commentNotification.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        isReplied: true,
        repliedAt: true,
        createdAt: true,
        comment: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
        post: { select: { id: true, title: true, community: { select: { id: true, name: true } } } },
      },
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const notifications: CommentNotificationItemDTO[] = page.map(r => ({
      id: r.id,
      isReplied: r.isReplied,
      repliedAt: r.repliedAt,
      createdAt: r.createdAt,
      comment: {
        id: r.comment.id,
        content: r.comment.content,
        createdAt: r.comment.createdAt,
        author: r.comment.author,
      },
      post: { id: r.post.id, title: r.post.title, communityId: r.post.community.id, communityName: r.post.community.name },
    }))

    const last = page.at(-1)
    return { notifications, nextCursor: hasMore && last ? last.id : null, hasMore }
  }

  async markNotificationReplied(accessibleCommunityIds: string[] | null, notificationId: string): Promise<CommentNotificationItemDTO> {
    const existing = await this.db.commentNotification.findUnique({
      where: { id: notificationId },
      select: { id: true, isReplied: true, post: { select: { communityId: true } } },
    })
    if (!existing) throw new NotFoundError('Notification not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, existing.post.communityId)
    if (existing.isReplied) throw new BadRequestError('Notification already marked as replied')

    const updated = await this.db.commentNotification.update({
      where: { id: notificationId },
      data: { isReplied: true, repliedAt: new Date() },
      select: {
        id: true,
        isReplied: true,
        repliedAt: true,
        createdAt: true,
        comment: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
        post: { select: { id: true, title: true, community: { select: { id: true, name: true } } } },
      },
    })

    logger.info({ notificationId }, 'admin.markNotificationReplied')

    // Let other admins with this thread open on Unresolved Threads know it's
    // resolved, so they don't reply to something already handled.
    try {
      const adminIds = await getCommunityAdminIds(this.db, updated.post.community.id)
      await Promise.all(
        adminIds.map(adminId =>
          redis.publish(
            NOTIFICATIONS_PUBSUB_CHANNEL,
            JSON.stringify({
              userId: adminId,
              type: 'thread-resolved',
              communityId: updated.post.community.id,
              message: 'Thread marked as replied',
              sourceId: notificationId,
              postId: updated.post.id,
            } satisfies LiveNotificationEvent),
          ),
        ),
      )
    } catch (err) {
      logger.error({ err, notificationId }, 'admin.markNotificationReplied: failed to publish live thread-resolved notification')
    }

    return {
      id: updated.id,
      isReplied: updated.isReplied,
      repliedAt: updated.repliedAt,
      createdAt: updated.createdAt,
      comment: {
        id: updated.comment.id,
        content: updated.comment.content,
        createdAt: updated.comment.createdAt,
        author: updated.comment.author,
      },
      post: { id: updated.post.id, title: updated.post.title, communityId: updated.post.community.id, communityName: updated.post.community.name },
    }
  }

  async markAllNotificationsReplied(
    accessibleCommunityIds: string[] | null,
    communityId: string | undefined,
  ): Promise<MarkAllRepliedDTO> {
    if (communityId) assertCommunityAccessFromToken(accessibleCommunityIds, communityId)

    const postFilter = communityId
      ? { communityId }
      : accessibleCommunityIds !== null
        ? { communityId: { in: accessibleCommunityIds } }
        : undefined

    const result = await this.db.commentNotification.updateMany({
      where: {
        isReplied: false,
        ...(postFilter ? { post: postFilter } : {}),
      },
      data: { isReplied: true, repliedAt: new Date() },
    })

    logger.info({ communityId, count: result.count }, 'admin.markAllNotificationsReplied')
    return { count: result.count }
  }

  async listPendingPostThreads(
    accessibleCommunityIds: string[] | null,
    communityId: string | undefined,
    search: string | undefined,
  ): Promise<PostThreadSummaryDTO[]> {
    if (communityId) assertCommunityAccessFromToken(accessibleCommunityIds, communityId)

    const postFilter = communityId
      ? { communityId }
      : accessibleCommunityIds !== null
        ? { communityId: { in: accessibleCommunityIds } }
        : undefined

    const grouped = await this.db.commentNotification.groupBy({
      by: ['postId'],
      where: {
        isReplied: false,
        ...(postFilter ? { post: postFilter } : {}),
      },
      _count: { _all: true },
    })
    if (grouped.length === 0) return []

    const pendingCountByPost = new Map(grouped.map(g => [g.postId, g._count._all]))
    const term = search?.trim().replace(/^#/, '')

    const posts = await this.db.post.findMany({
      where: {
        id: { in: grouped.map(g => g.postId) },
        deletedAt: null,
        ...(term
          ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { tags: { hasSome: [term, `#${term}`] } }] }
          : {}),
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        contentMd: true,
        imageUrls: true,
        tags: true,
        publishedAt: true,
        createdAt: true,
        community: { select: { id: true, name: true, badgeUrl: true } },
        author: { select: { name: true, avatarUrl: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
    })

    return posts.map(p => ({
      id: p.id,
      title: p.title,
      contentMd: p.contentMd,
      imageUrls: p.imageUrls,
      tags: p.tags,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      communityId: p.community.id,
      communityName: p.community.name,
      communityBadgeUrl: p.community.badgeUrl,
      authorName: p.author.name,
      authorAvatarUrl: p.author.avatarUrl,
      totalComments: p._count.comments,
      pendingThreads: pendingCountByPost.get(p.id) ?? 0,
    }))
  }

  async getDashboard(): Promise<DashboardDTO> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const sevenDaysLater = new Date(today)
    sevenDaysLater.setDate(today.getDate() + 7)

    const [
      totalMembers,
      activeSubscriptions,
      pendingRegistration,
      expiringThisWeek,
      unresolvedThreads,
      communities,
      breakdownRaw,
      registeredRaw,
      expiringSoonRaw,
    ] = await Promise.all([
      // Total users with member role (excludes admins)
      this.db.user.count({ where: { role: 'member', deletedAt: null } }),

      // Registered users with active subscription
      this.db.subscription.count({
        where: {
          isActive: true,
          user: { passwordHash: { not: null }, isActive: true },
        },
      }),

      // Added by admin but haven't registered yet
      this.db.user.count({
        where: { role: 'member', passwordHash: null },
      }),

      // Subscriptions expiring within 7 days
      this.db.subscription.count({
        where: {
          isActive: true,
          validUntil: { gte: today, lte: sevenDaysLater },
        },
      }),

      // Unresolved comment notifications
      this.db.commentNotification.count({ where: { isReplied: false } }),

      // All communities for breakdown
      this.db.community.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),

      // Per-community total subscriptions (all members regardless of registration)
      this.db.subscription.groupBy({
        by: ['communityId'],
        where: { isActive: true },
        _count: { userId: true },
      }),

      // Per-community registered count (has password set)
      this.db.subscription.groupBy({
        by: ['communityId'],
        where: {
          isActive: true,
          user: { passwordHash: { not: null }, isActive: true },
        },
        _count: { userId: true },
      }),

      // Expiring soon — next 7 days, top 5
      this.db.subscription.findMany({
        where: {
          isActive: true,
          validUntil: { gte: today, lte: sevenDaysLater },
        },
        select: {
          communityId: true,
          validUntil: true,
          user: { select: { id: true, name: true } },
          community: { select: { name: true } },
        },
        orderBy: { validUntil: 'asc' },
        take: 5,
      }),
    ])

    const communityBreakdown = communities.map(c => {
      const total = breakdownRaw.find(r => r.communityId === c.id)?._count.userId ?? 0
      const registered = registeredRaw.find(r => r.communityId === c.id)?._count.userId ?? 0
      return {
        communityId: c.id,
        communityName: c.name,
        memberCount: total,
        registeredCount: registered,
        registrationPercentage: total > 0 ? Math.round((registered / total) * 100) : 0,
      }
    }).filter(c => c.memberCount > 0)

    function mkInitials(name: string) {
      return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
    }

    const expiringSoon = expiringSoonRaw.map(s => {
      const daysLeft = Math.ceil(
        (new Date(s.validUntil).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      )
      return {
        userId: s.user.id,
        name: s.user.name,
        initials: mkInitials(s.user.name),
        communityId: s.communityId,
        communityName: s.community.name,
        validUntil: s.validUntil.toISOString().slice(0, 10),
        daysLeft,
      }
    })

    return {
      stats: { totalMembers, activeSubscriptions, pendingRegistration, expiringThisWeek, unresolvedThreads },
      communityBreakdown,
      expiringSoon,
    }
  }

  async validateImport(rows: ValidateImportRowInput[]): Promise<ValidateImportDTO> {
    const communities = await this.db.community.findMany({
      where: { deletedAt: null },
      select: { name: true },
    })
    const communityNames = new Set(communities.map(c => c.name.toLowerCase()))

    // Batch-fetch existing phones and emails from the DB
    const phones = rows.map(r => r.phone).filter(Boolean)
    const emails = rows.map(r => r.email).filter(Boolean)

    const [existingByPhone, existingByEmail] = await Promise.all([
      this.db.approvedPhone.findMany({
        where: { phone: { in: phones } },
        select: { phone: true, name: true },
      }),
      this.db.user.findMany({
        where: { email: { in: emails } },
        select: { email: true, phone: true, name: true },
      }),
    ])

    const existingPhoneSet = new Set(existingByPhone.map(r => r.phone))
    const existingEmailMap = new Map(existingByEmail.map(r => [r.email, r]))

    const results: ValidateImportRowResult[] = rows.map(row => {
      const errors: string[] = []
      const warnings: string[] = []

      // Format validations
      if (!row.name?.trim()) errors.push('Name is required')

      if (!row.phone?.trim()) {
        errors.push('Phone is required')
      } else if (!normalizePhone(row.phone)) {
        errors.push('Invalid phone number')
      }

      if (!row.email?.trim()) {
        errors.push('Email is required')
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        errors.push('Invalid email address')
      }

      if (!row.service?.trim()) {
        errors.push('Service is required')
      } else if (!communityNames.has(row.service.toLowerCase())) {
        errors.push(`Community "${row.service}" not found`)
      }

      if (!row.payment || isNaN(row.payment) || row.payment <= 0) {
        errors.push('Invalid payment amount')
      }

      if (!row.valid?.trim()) errors.push('Valid date is required')

      // Duplicate checks (warnings, not errors)
      const phoneExists = existingPhoneSet.has(row.phone)
      const emailMatch = row.email ? existingEmailMap.get(row.email) : undefined
      const emailExistsDifferentPhone = emailMatch && emailMatch.phone !== row.phone

      if (phoneExists) {
        warnings.push(`Phone already exists — customer "${existingByPhone.find(p => p.phone === row.phone)?.name ?? row.phone}" will be updated based on strategy`)
      }
      if (emailExistsDifferentPhone) {
        warnings.push(`Email already registered under a different phone (${emailMatch!.phone})`)
      }

      return {
        rowNum: row.rowNum,
        errors,
        warnings,
        isDuplicate: phoneExists || !!emailExistsDifferentPhone,
      }
    })

    return { results }
  }

  async listCommunities(accessibleCommunityIds: string[] | null): Promise<CommunityDTO[]> {
    const communities = await this.db.community.findMany({
      where: {
        deletedAt: null,
        ...(accessibleCommunityIds !== null ? { id: { in: accessibleCommunityIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        tags: true,
        coverImageUrl: true,
        badgeUrl: true,
        paymentLink: true,
        _count: { select: { subscriptions: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
    })
    return communities.map(c => {
      const { _count, ...community } = c
      return { ...community, memberCount: _count.subscriptions }
    })
  }

  async createCommunity(adminId: string, data: CreateCommunityDTO): Promise<CommunityDTO> {
    await assertSuperAdmin(this.db, adminId)

    const base = slugify(data.slug ?? data.name)
    if (!base) throw new BadRequestError('Name must contain at least one letter or number')

    let slug = base
    let suffix = 2
    while (await this.db.community.findUnique({ where: { slug } })) {
      slug = `${base}-${suffix}`
      suffix++
    }

    const community = await this.db.community.create({
      data: {
        createdBy: adminId,
        name: data.name,
        slug,
        description: data.description ?? null,
        tags: data.tags,
        coverImageUrl: data.coverImageUrl ?? null,
        badgeUrl: data.badgeUrl ?? null,
        paymentLink: data.paymentLink ?? null,
      },
      select: { id: true, name: true, slug: true, description: true, tags: true, coverImageUrl: true, badgeUrl: true, paymentLink: true },
    })

    logger.info({ communityId: community.id, slug }, 'admin.createCommunity: success')
    return { ...community, memberCount: 0 }
  }

  async getCommunityUploadUrl(filename: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    return generateUploadUrl(filename, 'communities')
  }

  async updateCommunity(adminId: string, communityId: string, data: UpdateCommunityDTO): Promise<CommunityDTO> {
    await assertSuperAdmin(this.db, adminId)

    const existing = await this.db.community.findUnique({ where: { id: communityId } })
    if (!existing || existing.deletedAt) throw new NotFoundError('Community not found')

    const community = await this.db.community.update({
      where: { id: communityId },
      data: {
        name: data.name,
        description: data.description ?? null,
        tags: data.tags,
        coverImageUrl: data.coverImageUrl ?? null,
        badgeUrl: data.badgeUrl ?? null,
        paymentLink: data.paymentLink ?? null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        tags: true,
        coverImageUrl: true,
        badgeUrl: true,
        paymentLink: true,
        _count: { select: { subscriptions: { where: { isActive: true } } } },
      },
    })

    logger.info({ communityId }, 'admin.updateCommunity: success')
    const { _count, ...rest } = community
    return { ...rest, memberCount: _count.subscriptions }
  }

  async deleteCommunity(adminId: string, communityId: string): Promise<void> {
    await assertSuperAdmin(this.db, adminId)

    const existing = await this.db.community.findUnique({ where: { id: communityId } })
    if (!existing || existing.deletedAt) throw new NotFoundError('Community not found')

    // Soft-delete the community and its posts; deactivate (don't delete) members'
    // accounts — a User can belong to other communities too, so only this
    // community's membership/subscription is revoked, not the User itself.
    const now = new Date()
    await this.db.$transaction([
      this.db.community.update({ where: { id: communityId }, data: { deletedAt: now } }),
      this.db.post.updateMany({ where: { communityId, deletedAt: null }, data: { deletedAt: now } }),
      this.db.subscription.updateMany({ where: { communityId, isActive: true }, data: { isActive: false } }),
      this.db.communityMember.deleteMany({ where: { communityId } }),
      this.db.communityAdmin.deleteMany({ where: { communityId } }),
    ])

    logger.info({ communityId }, 'admin.deleteCommunity: success')
  }

  async listAdmins(requestingAdminId: string): Promise<AdminUserDTO[]> {
    await assertSuperAdmin(this.db, requestingAdminId)
    const admins = await this.db.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        isSuperAdmin: true,
        communityAccess: { select: { community: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { name: 'asc' },
    })
    return admins.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      avatarUrl: a.avatarUrl,
      isSuperAdmin: a.isSuperAdmin,
      communityAccess: a.communityAccess.map(ca => ca.community),
    }))
  }

  async grantCommunityAccess(requestingAdminId: string, targetAdminId: string, communityId: string): Promise<void> {
    await assertSuperAdmin(this.db, requestingAdminId)

    const target = await this.db.user.findUnique({ where: { id: targetAdminId } })
    if (!target || target.role !== 'admin') throw new NotFoundError('Admin not found')

    const community = await this.db.community.findUnique({ where: { id: communityId, deletedAt: null } })
    if (!community) throw new NotFoundError('Community not found')

    await this.db.communityAdmin.upsert({
      where: { uq_community_admin: { communityId, adminId: targetAdminId } },
      create: { communityId, adminId: targetAdminId },
      update: {},
    })
    logger.info({ targetAdminId, communityId }, 'admin.grantCommunityAccess: success')
  }

  async revokeCommunityAccess(requestingAdminId: string, targetAdminId: string, communityId: string): Promise<void> {
    await assertSuperAdmin(this.db, requestingAdminId)
    await this.db.communityAdmin.deleteMany({ where: { adminId: targetAdminId, communityId } })
    logger.info({ targetAdminId, communityId }, 'admin.revokeCommunityAccess: success')
  }

  async createAdmin(requestingAdminId: string, data: CreateAdminDTO): Promise<AdminUserDTO> {
    await assertSuperAdmin(this.db, requestingAdminId)

    const phone = normalizePhone(data.phone)
    if (!phone) throw new BadRequestError('Invalid phone number')

    if (await this.db.user.findUnique({ where: { phone } })) {
      throw new ConflictError('Phone number already in use', 'PHONE_EXISTS')
    }
    if (await this.db.user.findUnique({ where: { email: data.email } })) {
      throw new ConflictError('Email address already in use', 'EMAIL_EXISTS')
    }

    const communities = await this.db.community.findMany({
      where: { id: { in: data.communityIds }, deletedAt: null },
      select: { id: true, name: true, slug: true },
    })
    if (communities.length !== data.communityIds.length) {
      throw new BadRequestError('One or more community IDs are invalid')
    }

    const passwordHash = await bcrypt.hash(data.password, 12)

    const created = await this.db.$transaction(async tx => {
      const user = await tx.user.create({
        data: { phone, name: data.name, email: data.email, passwordHash, role: 'admin' },
      })
      await tx.communityAdmin.createMany({
        data: data.communityIds.map(cid => ({ adminId: user.id, communityId: cid })),
      })
      return user
    })

    logger.info({ adminId: created.id }, 'admin.createAdmin: success')
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      avatarUrl: created.avatarUrl,
      isSuperAdmin: false,
      communityAccess: communities,
    }
  }

  async updateAdminAccess(requestingAdminId: string, targetAdminId: string, data: UpdateAdminAccessDTO): Promise<AdminUserDTO> {
    await assertSuperAdmin(this.db, requestingAdminId)

    if (requestingAdminId === targetAdminId) {
      throw new ForbiddenError('Cannot modify your own community access')
    }

    const target = await this.db.user.findUnique({ where: { id: targetAdminId } })
    if (!target || target.role !== 'admin' || target.deletedAt) {
      throw new NotFoundError('Admin not found')
    }

    const communities = await this.db.community.findMany({
      where: { id: { in: data.communityIds }, deletedAt: null },
      select: { id: true, name: true, slug: true },
    })
    if (communities.length !== data.communityIds.length) {
      throw new BadRequestError('One or more community IDs are invalid')
    }

    await this.db.$transaction(async tx => {
      await tx.communityAdmin.deleteMany({ where: { adminId: targetAdminId } })
      await tx.communityAdmin.createMany({
        data: data.communityIds.map(cid => ({ adminId: targetAdminId, communityId: cid })),
      })
    })

    logger.info({ targetAdminId }, 'admin.updateAdminAccess: success')
    return {
      id: target.id,
      name: target.name,
      email: target.email,
      avatarUrl: target.avatarUrl,
      isSuperAdmin: target.isSuperAdmin,
      communityAccess: communities,
    }
  }

  async deleteAdmin(requestingAdminId: string, targetAdminId: string): Promise<void> {
    await assertSuperAdmin(this.db, requestingAdminId)

    if (requestingAdminId === targetAdminId) {
      throw new ForbiddenError('Cannot delete your own admin account')
    }

    const target = await this.db.user.findUnique({ where: { id: targetAdminId } })
    if (!target || target.role !== 'admin' || target.deletedAt) {
      throw new NotFoundError('Admin not found')
    }

    await this.db.user.update({ where: { id: targetAdminId }, data: { deletedAt: new Date() } })
    logger.info({ targetAdminId }, 'admin.deleteAdmin: success')
  }

  async addMember(data: AddMemberDTO, adminId: string): Promise<AddMemberResultDTO> {
    const phone = normalizePhone(data.phone)
    if (!phone) throw new BadRequestError('Invalid phone number')

    const community = await this.db.community.findUnique({ where: { id: data.communityId } })
    if (!community) throw new NotFoundError('Community not found')

    const existingUser = await this.db.user.findUnique({ where: { phone } })
    // A deleted member's User row is still there (isActive: false) — only a genuinely
    // active phone is a real conflict; an inactive one falls through to the revive path below.
    if (existingUser?.isActive) {
      throw new ConflictError('This phone number is already registered', 'PHONE_EXISTS')
    }
    const emailOwner = await this.db.user.findUnique({ where: { email: data.email } })
    if (emailOwner && emailOwner.phone !== phone) {
      throw new ConflictError('This email address is already registered', 'EMAIL_EXISTS')
    }

    const result = await this.db.$transaction(async tx => {
      let userId: string
      let approvedPhoneId: string
      if (existingUser) {
        const revived = await this.reviveMember(tx, existingUser, phone, data.name, data.email, adminId)
        userId = revived.userId
        approvedPhoneId = revived.approvedPhoneId
      } else {
        // Create User without password — user will set it when they register
        const user = await tx.user.create({
          data: { phone, name: data.name, email: data.email },
        })
        const ap = await tx.approvedPhone.create({
          data: { phone, name: data.name, email: data.email, addedBy: adminId },
        })
        userId = user.id
        approvedPhoneId = ap.id
      }
      await tx.subscription.create({
        data: {
          userId,
          approvedPhoneId,
          communityId: data.communityId,
          payment: data.payment,
          paidOn: new Date(),
          validUntil: new Date(data.validUntil),
        },
      })
      return { approvedPhoneId }
    })

    logger.info({ phone, adminId }, 'admin.addMember: created')

    try {
      await notificationsQueue.add(
        WELCOME_EMAIL_JOB,
        { toEmail: data.email, name: data.name, phone, communityName: community.name, validTill: new Date(data.validUntil).toISOString() },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, phone }, 'admin.addMember: failed to enqueue welcome email job')
    }

    return {
      approvedPhoneId: result.approvedPhoneId,
      phone,
      name: data.name,
      email: data.email,
      communityId: data.communityId,
      validUntil: data.validUntil,
    }
  }

  async extendSubscription(subscriptionId: string, data: ExtendSubscriptionDTO): Promise<ExtendSubscriptionResultDTO> {
    const current = await this.db.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: { select: { name: true, email: true } }, community: { select: { name: true } } },
    })
    if (!current) throw new NotFoundError('Subscription not found')

    const paidOn = data.paidOn ? new Date(data.paidOn) : new Date()
    const validUntil = new Date(data.validUntil)
    if (validUntil <= paidOn) {
      throw new BadRequestError('Valid until date must be after the paid-on date')
    }

    const created = await this.db.$transaction(async tx => {
      // Keep the old period as history — only the newest row is the active subscription
      await tx.subscription.update({ where: { id: current.id }, data: { isActive: false } })
      const sub = await tx.subscription.create({
        data: {
          userId: current.userId,
          approvedPhoneId: current.approvedPhoneId,
          communityId: current.communityId,
          payment: data.payment,
          paidOn,
          validUntil,
          isActive: true,
          createdAt: paidOn,
        },
      })
      await tx.notification.create({
        data: {
          communityId: current.communityId,
          userId: current.userId,
          type: NotificationType.SubscriptionExtended,
          sourceId: sub.id,
          title: 'Access extended',
          message: `You're active until ${formatEmailDate(sub.validUntil)}.`,
        },
      })
      return sub
    })

    logger.info(
      { previousSubscriptionId: current.id, newSubscriptionId: created.id, userId: current.userId },
      'admin.extendSubscription: extended',
    )

    try {
      await notificationsQueue.add(
        SUBSCRIPTION_EXTENDED_EMAIL_JOB,
        {
          toEmail: current.user.email,
          name: current.user.name,
          communityName: current.community.name,
          validTill: created.validUntil.toISOString(),
          amount: Number(created.payment),
          paidOn: (created.paidOn ?? paidOn).toISOString(),
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, subscriptionId: created.id }, 'admin.extendSubscription: failed to enqueue subscription-extended email job')
    }

    try {
      await redis.publish(
        NOTIFICATIONS_PUBSUB_CHANNEL,
        JSON.stringify({
          userId: current.userId,
          type: NotificationType.SubscriptionExtended,
          communityId: current.communityId,
          message: `You're active until ${formatEmailDate(created.validUntil)}.`,
          sourceId: created.id,
        } satisfies LiveNotificationEvent),
      )
    } catch (err) {
      logger.error({ err, subscriptionId: created.id }, 'admin.extendSubscription: failed to publish live notification')
    }

    return {
      id: created.id,
      userId: created.userId,
      communityId: created.communityId,
      payment: Number(created.payment),
      paidOn: created.paidOn ? created.paidOn.toISOString().split('T')[0]! : null,
      validUntil: created.validUntil.toISOString().split('T')[0]!,
      isActive: created.isActive,
    }
  }

  async deleteMember(approvedPhoneId: string): Promise<DeleteMemberResultDTO> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')

    // Linked only by phone (no formal FK) — same lookup pattern used throughout this file
    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })

    if (!user) {
      // Shouldn't happen: addMember/importUsers always create User + ApprovedPhone together.
      // Deactivate what we can rather than blocking the admin action; log loudly so it's traceable.
      logger.warn({ approvedPhoneId: ap.id, phone: ap.phone }, 'admin.deleteMember: no matching User row for this ApprovedPhone')
      await this.db.approvedPhone.update({ where: { id: ap.id }, data: { isActive: false } })
      return { approvedPhoneId: ap.id, userId: null, phone: ap.phone, isActive: false }
    }

    if (user.role === 'admin') {
      throw new ForbiddenError('Admin accounts cannot be deactivated from this endpoint')
    }

    await this.db.$transaction(async tx => {
      await tx.approvedPhone.update({ where: { id: ap.id }, data: { isActive: false } })
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } })
      // All historical + current subscription rows for this user, not just the active one
      await tx.subscription.updateMany({ where: { userId: user.id }, data: { isActive: false } })
    })

    logger.info({ approvedPhoneId: ap.id, userId: user.id, phone: ap.phone }, 'admin.deleteMember: deactivated')
    return { approvedPhoneId: ap.id, userId: user.id, phone: ap.phone, isActive: false }
  }

  async bulkDeleteMembers(approvedPhoneIds: string[]): Promise<BulkDeleteMembersResultDTO> {
    const errors: { approvedPhoneId: string; reason: string }[] = []
    let succeeded = 0

    for (const id of approvedPhoneIds) {
      try {
        await this.deleteMember(id)
        succeeded++
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error'
        errors.push({ approvedPhoneId: id, reason })
      }
    }

    logger.info(
      { total: approvedPhoneIds.length, succeeded, failed: errors.length },
      'admin.bulkDeleteMembers: complete',
    )
    return { total: approvedPhoneIds.length, succeeded, failed: errors.length, errors }
  }

  async suspendMember(approvedPhoneId: string, reason: string): Promise<SuspendMemberResultDTO> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')
    if (!ap.isActive) throw new ConflictError('This member was already deleted, not suspended')

    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })
    if (!user) throw new NotFoundError('Member not found')
    if (user.role === 'admin') throw new ForbiddenError('Admin accounts cannot be suspended')

    const updated = await this.db.user.update({
      where: { id: user.id },
      data: { isActive: false, suspensionReason: reason },
    })

    logger.info({ approvedPhoneId: ap.id, userId: user.id }, 'admin.suspendMember: suspended')

    try {
      await notificationsQueue.add(
        MEMBER_SUSPENDED_EMAIL_JOB,
        { toEmail: user.email, name: user.name, reason },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, approvedPhoneId }, 'admin.suspendMember: failed to enqueue suspension email job')
    }

    return {
      approvedPhoneId: ap.id,
      userId: updated.id,
      isActive: updated.isActive,
      suspensionReason: updated.suspensionReason!,
    }
  }

  async revokeSuspension(approvedPhoneId: string): Promise<RevokeSuspensionResultDTO> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')
    if (!ap.isActive) throw new ConflictError('This member was deleted, not suspended — cannot revoke')

    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })
    if (!user) throw new NotFoundError('Member not found')

    const updated = await this.db.user.update({
      where: { id: user.id },
      data: { isActive: true, suspensionReason: null },
    })

    logger.info({ approvedPhoneId: ap.id, userId: user.id }, 'admin.revokeSuspension: revoked')

    try {
      await notificationsQueue.add(
        MEMBER_REINSTATED_EMAIL_JOB,
        { toEmail: user.email, name: user.name },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, approvedPhoneId }, 'admin.revokeSuspension: failed to enqueue reinstated email job')
    }

    return { approvedPhoneId: ap.id, userId: updated.id, isActive: updated.isActive }
  }

  async listMembers(filters: MemberListFilters): Promise<MemberListDTO> {
    const { page, pageSize, ...whereFilters } = filters
    const { apWhere, currentSubIds } = await this.buildMemberWhere(whereFilters)
    const { members, total } = await this.queryMembers(apWhere, currentSubIds, { skip: (page - 1) * pageSize, take: pageSize })
    return { members, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  async exportMembersCsv(filters: MemberExportFilters): Promise<string> {
    const { apWhere, currentSubIds } = await this.buildMemberWhere(filters)
    const { members } = await this.queryMembers(apWhere, currentSubIds)
    return this.membersToCsv(members)
  }

  // Shared by listMembers (paginated) and exportMembersCsv (unpaginated — omit `pagination`
  // to fetch every matching row). When unpaginated, `total` is just `members.length` — no
  // separate count() query needed since the fetched rows already are the full result set.
  private async queryMembers(
    apWhere: Record<string, unknown>,
    currentSubIds: string[],
    pagination?: { skip: number; take: number },
  ): Promise<{ members: MemberItemDTO[]; total: number }> {
    const [total, rows] = await Promise.all([
      pagination ? this.db.approvedPhone.count({ where: apWhere }) : Promise.resolve(null),
      this.db.approvedPhone.findMany({
        where: apWhere,
        orderBy: { createdAt: 'desc' },
        ...pagination,
        include: {
          subscriptions: {
            where: { id: { in: currentSubIds } },
            include: { community: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ])

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Batch-fetch linked Users (isActive/suspensionReason) for these rows — ApprovedPhone
    // and User have no formal relation, only the shared phone string, same pattern as elsewhere.
    const users = await this.db.user.findMany({
      where: { phone: { in: rows.map(ap => ap.phone) } },
      select: { phone: true, isActive: true, suspensionReason: true, avatarUrl: true },
    })
    const userByPhone = new Map(users.map(u => [u.phone, u]))

    const members: MemberItemDTO[] = rows.map(ap => {
      const allSubs = ap.subscriptions
      const sub = allSubs[0] ?? null
      const user = userByPhone.get(ap.phone)
      const suspendedByUser = user ? !user.isActive : false

      let derivedStatus: MemberStatus
      if (!ap.isActive) {
        derivedStatus = 'deleted'
      } else if (suspendedByUser) {
        derivedStatus = 'suspended'
      } else if (!ap.isRegistered) {
        derivedStatus = 'pending'
      } else if (sub && (!sub.isActive || new Date(sub.validUntil) < today)) {
        derivedStatus = 'expired'
      } else {
        derivedStatus = 'registered'
      }

      return {
        id: ap.id,
        name: ap.name ?? '',
        phone: ap.phone,
        email: ap.email ?? '',
        avatarUrl: user?.avatarUrl ?? null,
        isActive: ap.isActive && !suspendedByUser,
        isRegistered: ap.isRegistered,
        status: derivedStatus,
        createdAt: ap.createdAt.toISOString(),
        suspensionReason: suspendedByUser ? (user?.suspensionReason ?? null) : null,
        subscription: sub
          ? {
              id: sub.id,
              communityId: sub.communityId,
              communityName: sub.community.name,
              payment: Number(sub.payment),
              paidOn: sub.paidOn ? sub.paidOn.toISOString().split('T')[0]! : null,
              validUntil: sub.validUntil.toISOString().split('T')[0]!,
              isActive: sub.isActive,
            }
          : null,
        allSubscriptions: allSubs.map(s => ({
          id: s.id,
          communityId: s.communityId,
          communityName: s.community.name,
          payment: Number(s.payment),
          paidOn: s.paidOn ? s.paidOn.toISOString().split('T')[0]! : null,
          validUntil: s.validUntil.toISOString().split('T')[0]!,
          isActive: s.isActive,
        })),
      }
    })

    return { members, total: total ?? members.length }
  }

  private membersToCsv(members: MemberItemDTO[]): string {
    const STATUS_LABELS: Record<MemberStatus, string> = {
      registered: 'Registered',
      pending: 'Pending Sign',
      expired: 'Expired',
      suspended: 'Suspended',
      deleted: 'Deleted',
    }
    const formatCurrency = (n: number) => `₹${n.toLocaleString('en-IN')}`
    const formatDate = (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`

    const header = ['Name', 'Phone', 'Email', 'Community', 'Payment', 'Paid On', 'Valid Till', 'Status', 'Added On']
    const rows = members
      .flatMap(m => (m.allSubscriptions.length > 0 ? m.allSubscriptions.map(sub => ({ m, sub })) : [{ m, sub: null as MemberSubscriptionDTO | null }]))
      .map(({ m, sub }) => [
        m.name,
        m.phone,
        m.email,
        sub?.communityName ?? '—',
        sub ? formatCurrency(sub.payment) : '—',
        formatDate(sub?.paidOn),
        formatDate(sub?.validUntil),
        STATUS_LABELS[m.status] ?? m.status,
        formatDate(m.createdAt),
      ])

    return '﻿' + [header, ...rows].map(r => r.map(escape).join(',')).join('\n')
  }

  // Brings a soft-deleted member (ApprovedPhone.isActive/User.isActive both false, per
  // deleteMember) back to life: overwrites their name/email with the freshly-submitted
  // values, and resets passwordHash + isRegistered so they go through register() again
  // exactly like a brand-new signup — deliberate, since deleteMember doesn't clear any of
  // this, so a revived member must not silently inherit their old password/session state.
  private async reviveMember(
    tx: Prisma.TransactionClient,
    existingUser: { id: string },
    phone: string,
    name: string,
    email: string,
    adminId: string,
  ): Promise<{ userId: string; approvedPhoneId: string }> {
    await tx.user.update({
      where: { id: existingUser.id },
      data: { name, email, passwordHash: null, isActive: true, suspensionReason: null },
    })
    const ap = await tx.approvedPhone.update({
      where: { phone },
      data: { name, email, isActive: true, isRegistered: false, addedBy: adminId },
    })
    return { userId: existingUser.id, approvedPhoneId: ap.id }
  }

  private async buildMemberWhere(
    filters: MemberExportFilters,
  ): Promise<{ apWhere: Record<string, unknown>; currentSubIds: string[] }> {
    const { communityId, communityIds, status, validFrom, validTo, paidFrom, paidTo, search } = filters
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Build subscription sub-filter — a member can have multiple historical (renewed)
    // subscription rows per community, so only the current one should count here.
    // "Current" = most recently created row per (member, community), not isActive:true —
    // see getCurrentSubscriptionIds for why. hasSubFilter tracks whether a subscription-level
    // filter is actually requested — a deactivated member has zero current subscriptions in
    // scope, and `some` on an always-present id-in-list would otherwise exclude them entirely
    // (e.g. status=suspended).
    const currentSubIds = await this.getCurrentSubscriptionIds()
    const subWhere: Record<string, unknown> = { id: { in: currentSubIds } }
    let hasSubFilter = false
    if (communityId) { subWhere['communityId'] = communityId; hasSubFilter = true }
    else if (communityIds) { subWhere['communityId'] = { in: communityIds }; hasSubFilter = true }
    if (validFrom || validTo) {
      subWhere['validUntil'] = {
        ...(validFrom ? { gte: new Date(validFrom) } : {}),
        ...(validTo ? { lte: new Date(validTo) } : {}),
      }
      hasSubFilter = true
    }
    if (paidFrom || paidTo) {
      subWhere['paidOn'] = {
        ...(paidFrom ? { gte: new Date(paidFrom) } : {}),
        ...(paidTo ? { lte: new Date(paidTo) } : {}),
      }
      hasSubFilter = true
    }

    // Exclude admin accounts (User.role = 'admin') — linked by phone
    const adminUsers = await this.db.user.findMany({
      where: { role: 'admin' },
      select: { phone: true },
    })
    const adminPhones = adminUsers.map(u => u.phone)

    // Suspension (suspendMember) only flips User.isActive, not ApprovedPhone.isActive — so
    // "suspended" has two independent sources of truth. Fetch which phones are suspended this
    // way once, up front, and fold it into both the status filter and the derived status below.
    const suspendedUsers = await this.db.user.findMany({
      where: { isActive: false },
      select: { phone: true },
    })
    const suspendedUserPhones = suspendedUsers.map(u => u.phone)

    // Build ApprovedPhone-level filter as an AND-list of conditions, since both `search` and
    // the suspended-status check below need their own OR group — can't just assign apWhere.OR twice.
    const andClauses: Record<string, unknown>[] = []
    if (adminPhones.length > 0) {
      andClauses.push({ phone: { notIn: adminPhones } })
    }
    if (search) {
      andClauses.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    // Status maps to DB fields
    const apWhere: Record<string, unknown> = {}
    if (status === 'deleted') {
      apWhere['isActive'] = false
    } else if (status === 'suspended') {
      apWhere['isActive'] = true
      andClauses.push({ phone: { in: suspendedUserPhones } })
    } else if (status === 'pending') {
      apWhere['isRegistered'] = false
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
    } else if (status === 'registered') {
      apWhere['isRegistered'] = true
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
      subWhere['isActive'] = true
      subWhere['validUntil'] = { ...((subWhere['validUntil'] as object) ?? {}), gte: today }
      hasSubFilter = true
    } else if (status === 'expired') {
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
      // Either naturally lapsed (validUntil passed — isActive may still be true within
      // expireLapsedSubscriptions' buffer window, or already false past it) or manually
      // revoked (isActive false regardless of validUntil) — both read as "expired" here.
      subWhere['OR'] = [{ isActive: false }, { validUntil: { lt: today } }]
      hasSubFilter = true
    }

    if (hasSubFilter) {
      apWhere['subscriptions'] = { some: subWhere }
    }
    if (andClauses.length > 0) {
      apWhere['AND'] = andClauses
    }

    return { apWhere, currentSubIds }
  }

  // "Current" subscription per community = most recently created row, not
  // isActive:true — expireLapsedSubscriptions (subscription-lifecycle.ts) now
  // flips isActive false on natural expiry too, on top of the pre-existing
  // renewal/revoke cases, so isActive alone no longer identifies "the row
  // admin should see" for a member+community. A superseding renewal is always
  // created after the row it replaces, so ordering by createdAt already
  // excludes superseded rows without needing isActive at all.
  private async getCurrentSubscriptionIds(): Promise<string[]> {
    // Prisma's query builder can't express "top 1 row per group" declaratively
    // (no DISTINCT ON / no id-of-groupBy-max) — a raw query is the direct fit.
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (approved_phone_id, community_id) id
      FROM subscriptions
      ORDER BY approved_phone_id, community_id, created_at DESC
    `
    return rows.map(r => r.id)
  }

  private latestSubscriptionPerCommunity<T extends { communityId: string; createdAt: Date }>(subs: T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []
    for (const s of [...subs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
      if (seen.has(s.communityId)) continue
      seen.add(s.communityId)
      result.push(s)
    }
    return result
  }

  private buildSubDTO(s: {
    id: string
    communityId: string
    community: { name: string }
    payment: { toNumber(): number } | number
    paidOn: Date | null
    validUntil: Date
    isActive: boolean
  }): MemberSubscriptionDTO {
    return {
      id: s.id,
      communityId: s.communityId,
      communityName: s.community.name,
      payment: typeof s.payment === 'number' ? s.payment : s.payment.toNumber(),
      paidOn: s.paidOn ? s.paidOn.toISOString().split('T')[0]! : null,
      validUntil: s.validUntil.toISOString().split('T')[0]!,
      isActive: s.isActive,
    }
  }

  async getMemberById(id: string): Promise<MemberItemDTO> {
    return this.fetchMemberDTO(id)
  }

  // Resolves a comment/post author's User.id to the ApprovedPhone.id their member
  // profile page is keyed by — same phone-matching idiom used everywhere else in
  // this file, since User and ApprovedPhone have no formal Prisma relation.
  async getApprovedPhoneIdForUser(userId: string): Promise<{ approvedPhoneId: string }> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { phone: true, role: true } })
    if (!user || user.role === 'admin') throw new NotFoundError('Member not found')

    const ap = await this.db.approvedPhone.findUnique({ where: { phone: user.phone }, select: { id: true } })
    if (!ap) throw new NotFoundError('Member not found')

    return { approvedPhoneId: ap.id }
  }

  async resetMemberPassword(approvedPhoneId: string, newPassword: string): Promise<MemberItemDTO> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')

    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })
    if (!user) throw new NotFoundError('Member not found')

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash } })

    logger.info({ approvedPhoneId }, 'admin.resetMemberPassword: password reset')
    return this.fetchMemberDTO(approvedPhoneId)
  }

  private async fetchMemberDTO(approvedPhoneId: string): Promise<MemberItemDTO> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const ap = await this.db.approvedPhone.findUnique({
      where: { id: approvedPhoneId },
      include: {
        subscriptions: {
          include: { community: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!ap) throw new NotFoundError('Member not found')

    const user = await this.db.user.findUnique({
      where: { phone: ap.phone },
      select: { isActive: true, suspensionReason: true, avatarUrl: true },
    })

    // "Current" per community = most recently created row, not isActive:true — see
    // getCurrentSubscriptionIds's comment on listMembers for why.
    const allSubs = this.latestSubscriptionPerCommunity(ap.subscriptions)
    const sub = allSubs[0] ?? null
    const suspendedByUser = user ? !user.isActive : false

    let status: MemberStatus
    if (!ap.isActive) status = 'deleted'
    else if (suspendedByUser) status = 'suspended'
    else if (!ap.isRegistered) status = 'pending'
    else if (sub && (!sub.isActive || new Date(sub.validUntil) < today)) status = 'expired'
    else status = 'registered'

    return {
      id: ap.id,
      name: ap.name ?? '',
      phone: ap.phone,
      email: ap.email ?? '',
      avatarUrl: user?.avatarUrl ?? null,
      isActive: ap.isActive && !suspendedByUser,
      isRegistered: ap.isRegistered,
      status,
      createdAt: ap.createdAt.toISOString(),
      suspensionReason: suspendedByUser ? (user?.suspensionReason ?? null) : null,
      subscription: sub ? this.buildSubDTO(sub) : null,
      allSubscriptions: allSubs.map(s => this.buildSubDTO(s)),
    }
  }

  async updateMember(approvedPhoneId: string, data: UpdateMemberDTO): Promise<MemberItemDTO> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')

    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })

    const normalizedPhone = normalizePhone(data.phone)
    if (!normalizedPhone) throw new BadRequestError('Invalid phone number')

    if (normalizedPhone !== ap.phone) {
      const phoneConflict = await this.db.approvedPhone.findUnique({ where: { phone: normalizedPhone } })
      if (phoneConflict) throw new ConflictError('Phone number already in use', 'PHONE_EXISTS')
    }
    if (data.email !== (ap.email ?? '')) {
      const emailConflict = await this.db.user.findUnique({ where: { email: data.email } })
      if (emailConflict && emailConflict.phone !== ap.phone) {
        throw new ConflictError('Email address already in use', 'EMAIL_EXISTS')
      }
    }

    let addedCommunityName: string | null = null
    if (data.newCommunity) {
      const community = await this.db.community.findUnique({
        where: { id: data.newCommunity.communityId, deletedAt: null },
      })
      if (!community) throw new NotFoundError('Community not found')
      addedCommunityName = community.name
      if (user) {
        const alreadyIn = await this.db.subscription.findFirst({
          where: { userId: user.id, communityId: data.newCommunity.communityId, isActive: true },
        })
        if (alreadyIn) throw new ConflictError('Member is already in this community', 'ALREADY_IN_COMMUNITY')
      }
    }

    const newSubscriptionId = await this.db.$transaction(async tx => {
      await tx.approvedPhone.update({
        where: { id: approvedPhoneId },
        data: { name: data.name, phone: normalizedPhone, email: data.email },
      })
      if (user) {
        await tx.user.update({
          where: { id: user.id },
          data: { name: data.name, phone: normalizedPhone, email: data.email },
        })
      }
      if (data.newCommunity && user && addedCommunityName) {
        const paidOn = data.newCommunity.paidOn ? new Date(data.newCommunity.paidOn) : new Date()
        const validUntil = new Date(data.newCommunity.validUntil)
        const sub = await tx.subscription.create({
          data: {
            userId: user.id,
            approvedPhoneId,
            communityId: data.newCommunity.communityId,
            payment: data.newCommunity.payment,
            paidOn,
            validUntil,
            isActive: true,
          },
        })
        await tx.notification.create({
          data: {
            communityId: data.newCommunity.communityId,
            userId: user.id,
            type: NotificationType.CommunityAdded,
            sourceId: sub.id,
            title: `You've been added to ${addedCommunityName}`,
            message: `Active until ${formatEmailDate(validUntil)}.`,
          },
        })
        return sub.id
      }
      return null
    })

    if (data.newCommunity && user && addedCommunityName) {
      try {
        await notificationsQueue.add(
          COMMUNITY_ADDED_EMAIL_JOB,
          {
            toEmail: data.email,
            name: data.name,
            communityName: addedCommunityName,
            validTill: new Date(data.newCommunity.validUntil).toISOString(),
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
        )
      } catch (err) {
        logger.error({ err, approvedPhoneId }, 'admin.updateMember: failed to enqueue community-added email job')
      }

      if (newSubscriptionId) {
        try {
          await redis.publish(
            NOTIFICATIONS_PUBSUB_CHANNEL,
            JSON.stringify({
              userId: user.id,
              type: NotificationType.CommunityAdded,
              communityId: data.newCommunity.communityId,
              message: `Active until ${formatEmailDate(new Date(data.newCommunity.validUntil))}.`,
              sourceId: newSubscriptionId,
            } satisfies LiveNotificationEvent),
          )
        } catch (err) {
          logger.error({ err, approvedPhoneId }, 'admin.updateMember: failed to publish live notification')
        }
      }
    }

    logger.info({ approvedPhoneId }, 'admin.updateMember: success')
    return this.fetchMemberDTO(approvedPhoneId)
  }

  async revokeMemberCommunity(approvedPhoneId: string, communityId: string): Promise<void> {
    const ap = await this.db.approvedPhone.findUnique({ where: { id: approvedPhoneId } })
    if (!ap) throw new NotFoundError('Member not found')

    const user = await this.db.user.findUnique({ where: { phone: ap.phone } })
    if (!user) throw new NotFoundError('Member account not found')

    const sub = await this.db.subscription.findFirst({
      where: { userId: user.id, communityId, isActive: true },
    })
    if (!sub) throw new NotFoundError('Active subscription not found for this community')

    const community = await this.db.community.findUnique({ where: { id: communityId }, select: { name: true } })

    await this.db.subscription.update({ where: { id: sub.id }, data: { isActive: false } })

    const remaining = await this.db.subscription.count({ where: { userId: user.id, isActive: true } })
    if (remaining === 0) {
      await this.db.$transaction(async tx => {
        await tx.approvedPhone.update({ where: { id: approvedPhoneId }, data: { isActive: false } })
        await tx.user.update({ where: { id: user.id }, data: { isActive: false } })
      })
    }

    try {
      await notificationsQueue.add(
        COMMUNITY_ACCESS_REMOVED_EMAIL_JOB,
        { toEmail: user.email, name: user.name, communityName: community?.name ?? '' },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, approvedPhoneId, communityId }, 'admin.revokeMemberCommunity: failed to enqueue access-removed email job')
    }

    logger.info({ approvedPhoneId, communityId, remaining }, 'admin.revokeMemberCommunity: success')
  }
}
