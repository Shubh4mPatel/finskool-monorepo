import { createRequire } from 'module'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  DuplicateStrategy,
  ImportSummaryDTO,
  ImportRowDTO,
  CommentNotificationItemDTO,
  CommentNotificationListDTO,
  AddMemberDTO,
  AddMemberResultDTO,
  CommunityDTO,
  MemberListFilters,
  MemberListDTO,
  MemberItemDTO,
  MemberStatus,
  DashboardDTO,
} from './admin.dto.js'

const _require = createRequire(import.meta.url)
const XLSX = _require('xlsx') as {
  read(data: Buffer, opts: object): { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json<T>(ws: unknown, opts?: object): T[] }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return null
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

      // Uniqueness is on (user, community) — check if this specific subscription already exists
      const existingSub = existingUser
        ? await this.db.subscription.findUnique({
            where: { uq_subscription_user_community: { userId: existingUser.id, communityId: community.id } },
          })
        : null

      if (existingSub) {
        // This (user + community) combo exists — skip or overwrite based on strategy
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
      }
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

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 1
      const phone = normalizePhone(row.phone)
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
          ? await this.db.subscription.findUnique({
              where: { uq_subscription_user_community: { userId: existingUser.id, communityId: community.id } },
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
        } else if (existingUser && existingAp) {
          await this.db.subscription.create({
            data: { userId: existingUser.id, approvedPhoneId: existingAp.id, communityId: community.id, payment, paidOn, validUntil },
          })
          summary.created++
        } else {
          await this.db.$transaction(async tx => {
            const user = await tx.user.create({ data: { phone, name: row.name, email: row.email } })
            const ap = await tx.approvedPhone.create({ data: { phone, name: row.name, email: row.email, addedBy: adminId } })
            await tx.subscription.create({
              data: { userId: user.id, approvedPhoneId: ap.id, communityId: community.id, payment, paidOn, validUntil },
            })
          })
          summary.created++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        summary.errors.push({ row: rowNum, phone, reason: msg })
      }
    }

    logger.info(summary, 'admin.importUsersFromJSON: complete')
    return summary
  }

  async listCommentNotifications(
    isReplied: boolean | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<CommentNotificationListDTO> {
    const where = isReplied !== undefined ? { isReplied } : {}

    const rows = await this.db.commentNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
        post: { select: { id: true, title: true } },
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
      post: r.post,
    }))

    const last = page.at(-1)
    return { notifications, nextCursor: hasMore && last ? last.id : null, hasMore }
  }

  async markNotificationReplied(notificationId: string): Promise<CommentNotificationItemDTO> {
    const existing = await this.db.commentNotification.findUnique({
      where: { id: notificationId },
      select: { id: true, isReplied: true },
    })
    if (!existing) throw new NotFoundError('Notification not found')
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
        post: { select: { id: true, title: true } },
      },
    })

    logger.info({ notificationId }, 'admin.markNotificationReplied')
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
      post: updated.post,
    }
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

  async listCommunities(): Promise<CommunityDTO[]> {
    const communities = await this.db.community.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    })
    return communities
  }

  async addMember(data: AddMemberDTO, adminId: string): Promise<AddMemberResultDTO> {
    const digits = data.phone.replace(/\D/g, '')
    const phone =
      digits.length === 10 ? `+91${digits}`
      : digits.length === 12 && digits.startsWith('91') ? `+${digits}`
      : data.phone

    const community = await this.db.community.findUnique({ where: { id: data.communityId } })
    if (!community) throw new NotFoundError('Community not found')

    if (await this.db.user.findUnique({ where: { phone } })) {
      throw new ConflictError('This phone number is already registered', 'PHONE_EXISTS')
    }
    if (await this.db.user.findUnique({ where: { email: data.email } })) {
      throw new ConflictError('This email address is already registered', 'EMAIL_EXISTS')
    }

    const result = await this.db.$transaction(async tx => {
      // Create User without password — user will set it when they register
      const user = await tx.user.create({
        data: { phone, name: data.name, email: data.email },
      })
      const ap = await tx.approvedPhone.create({
        data: { phone, name: data.name, email: data.email, addedBy: adminId },
      })
      await tx.subscription.create({
        data: {
          userId: user.id,
          approvedPhoneId: ap.id,
          communityId: data.communityId,
          payment: data.payment,
          paidOn: new Date(),
          validUntil: new Date(data.validUntil),
        },
      })
      return { user, ap }
    })

    logger.info({ phone, adminId }, 'admin.addMember: created')
    return {
      approvedPhoneId: result.ap.id,
      phone: result.user.phone,
      name: result.user.name,
      email: result.user.email,
      communityId: data.communityId,
      validUntil: data.validUntil,
    }
  }

  async listMembers(filters: MemberListFilters): Promise<MemberListDTO> {
    const { communityId, status, validFrom, validTo, paidFrom, paidTo, search, page, pageSize } = filters
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Build subscription sub-filter
    const subWhere: Record<string, unknown> = {}
    if (communityId) subWhere['communityId'] = communityId
    if (validFrom || validTo) {
      subWhere['validUntil'] = {
        ...(validFrom ? { gte: new Date(validFrom) } : {}),
        ...(validTo ? { lte: new Date(validTo) } : {}),
      }
    }
    if (paidFrom || paidTo) {
      subWhere['paidOn'] = {
        ...(paidFrom ? { gte: new Date(paidFrom) } : {}),
        ...(paidTo ? { lte: new Date(paidTo) } : {}),
      }
    }

    // Exclude admin accounts (User.role = 'admin') — linked by phone
    const adminUsers = await this.db.user.findMany({
      where: { role: 'admin' },
      select: { phone: true },
    })
    const adminPhones = adminUsers.map(u => u.phone)

    // Build ApprovedPhone-level filter
    const apWhere: Record<string, unknown> = {}
    if (adminPhones.length > 0) {
      apWhere['phone'] = { notIn: adminPhones }
    }
    if (search) {
      apWhere['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Status maps to DB fields
    if (status === 'suspended') {
      apWhere['isActive'] = false
    } else if (status === 'pending') {
      apWhere['isRegistered'] = false
      apWhere['isActive'] = true
    } else if (status === 'registered') {
      apWhere['isRegistered'] = true
      apWhere['isActive'] = true
      subWhere['validUntil'] = { ...((subWhere['validUntil'] as object) ?? {}), gte: today }
    } else if (status === 'expired') {
      apWhere['isActive'] = true
      subWhere['validUntil'] = { lt: today }
    }

    if (Object.keys(subWhere).length > 0) {
      apWhere['subscriptions'] = { some: subWhere }
    }

    const [total, rows] = await Promise.all([
      this.db.approvedPhone.count({ where: apWhere }),
      this.db.approvedPhone.findMany({
        where: apWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          subscriptions: {
            include: { community: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ])

    const members: MemberItemDTO[] = rows.map(ap => {
      const sub = ap.subscriptions[0] ?? null

      let derivedStatus: MemberStatus
      if (!ap.isActive) {
        derivedStatus = 'suspended'
      } else if (!ap.isRegistered) {
        derivedStatus = 'pending'
      } else if (sub && new Date(sub.validUntil) < today) {
        derivedStatus = 'expired'
      } else {
        derivedStatus = 'registered'
      }

      return {
        id: ap.id,
        name: ap.name ?? '',
        phone: ap.phone,
        email: ap.email ?? '',
        isActive: ap.isActive,
        isRegistered: ap.isRegistered,
        status: derivedStatus,
        createdAt: ap.createdAt.toISOString(),
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
      }
    })

    return { members, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }
}
