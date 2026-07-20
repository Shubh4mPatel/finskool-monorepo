import { createRequire } from 'module'
import bcrypt from 'bcryptjs'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { assertSuperAdmin } from '../../lib/community-access.js'
import { generateUploadUrl } from '../../lib/minio.js'
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
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
  AdminUserDTO,
  CreateAdminDTO,
  UpdateAdminAccessDTO,
  MemberListFilters,
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
        post: { select: { id: true, title: true, community: { select: { id: true, name: true } } } },
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
      post: { id: updated.post.id, title: updated.post.title, communityId: updated.post.community.id, communityName: updated.post.community.name },
    }
  }

  async markAllNotificationsReplied(communityId: string | undefined): Promise<MarkAllRepliedDTO> {
    const result = await this.db.commentNotification.updateMany({
      where: {
        isReplied: false,
        ...(communityId ? { post: { communityId } } : {}),
      },
      data: { isReplied: true, repliedAt: new Date() },
    })

    logger.info({ communityId, count: result.count }, 'admin.markAllNotificationsReplied')
    return { count: result.count }
  }

  async listPendingPostThreads(communityId: string | undefined, search: string | undefined): Promise<PostThreadSummaryDTO[]> {
    const grouped = await this.db.commentNotification.groupBy({
      by: ['postId'],
      where: {
        isReplied: false,
        ...(communityId ? { post: { communityId } } : {}),
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
      orderBy: { publishedAt: 'asc' },
      select: {
        id: true,
        title: true,
        contentMd: true,
        imageUrls: true,
        tags: true,
        publishedAt: true,
        createdAt: true,
        community: { select: { id: true, name: true } },
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

      const phoneDigits = row.phone.replace(/\D/g, '')
      if (!row.phone?.trim()) {
        errors.push('Phone is required')
      } else if (
        !/^\d{10,12}$/.test(phoneDigits) &&
        !/^\+[1-9]\d{6,14}$/.test(row.phone.trim())
      ) {
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

  async listCommunities(): Promise<CommunityDTO[]> {
    const communities = await this.db.community.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        tags: true,
        coverImageUrl: true,
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
      },
      select: { id: true, name: true, slug: true, description: true, tags: true, coverImageUrl: true },
    })

    logger.info({ communityId: community.id, slug }, 'admin.createCommunity: success')
    return { ...community, memberCount: 0 }
  }

  async getCommunityUploadUrl(filename: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    return generateUploadUrl(filename, 'communities')
  }

  async listAdmins(): Promise<AdminUserDTO[]> {
    const admins = await this.db.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        isSuperAdmin: true,
        communityAccess: { select: { community: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { name: 'asc' },
    })
    return admins.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
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

    const digits = data.phone.replace(/\D/g, '')
    const phone =
      digits.length === 10 ? `+91${digits}`
      : digits.length === 12 && digits.startsWith('91') ? `+${digits}`
      : data.phone

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

  async extendSubscription(subscriptionId: string, data: ExtendSubscriptionDTO): Promise<ExtendSubscriptionResultDTO> {
    const current = await this.db.subscription.findUnique({ where: { id: subscriptionId } })
    if (!current) throw new NotFoundError('Subscription not found')

    const paidOn = data.paidOn ? new Date(data.paidOn) : new Date()
    const validUntil = new Date(data.validUntil)
    if (validUntil <= paidOn) {
      throw new BadRequestError('Valid until date must be after the paid-on date')
    }

    const created = await this.db.$transaction(async tx => {
      // Keep the old period as history — only the newest row is the active subscription
      await tx.subscription.update({ where: { id: current.id }, data: { isActive: false } })
      return tx.subscription.create({
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
    })

    logger.info(
      { previousSubscriptionId: current.id, newSubscriptionId: created.id, userId: current.userId },
      'admin.extendSubscription: extended',
    )
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
    return { approvedPhoneId: ap.id, userId: updated.id, isActive: updated.isActive }
  }

  async listMembers(filters: MemberListFilters): Promise<MemberListDTO> {
    const { communityId, communityIds, status, validFrom, validTo, paidFrom, paidTo, search, page, pageSize } = filters
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Build subscription sub-filter — a member can have multiple historical (renewed)
    // subscription rows per community, so only the current active one should count here.
    // hasSubFilter tracks whether a subscription-level filter is actually requested — a
    // deactivated member has zero active subscriptions, and `some` on an always-present
    // isActive:true would otherwise exclude them from the list entirely (e.g. status=suspended).
    const subWhere: Record<string, unknown> = { isActive: true }
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
    if (status === 'suspended') {
      andClauses.push({ OR: [{ isActive: false }, { phone: { in: suspendedUserPhones } }] })
    } else if (status === 'pending') {
      apWhere['isRegistered'] = false
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
    } else if (status === 'registered') {
      apWhere['isRegistered'] = true
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
      subWhere['validUntil'] = { ...((subWhere['validUntil'] as object) ?? {}), gte: today }
      hasSubFilter = true
    } else if (status === 'expired') {
      apWhere['isActive'] = true
      if (suspendedUserPhones.length > 0) andClauses.push({ phone: { notIn: suspendedUserPhones } })
      subWhere['validUntil'] = { lt: today }
      hasSubFilter = true
    }

    if (hasSubFilter) {
      apWhere['subscriptions'] = { some: subWhere }
    }
    if (andClauses.length > 0) {
      apWhere['AND'] = andClauses
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
            where: { isActive: true },
            include: { community: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ])

    // Batch-fetch linked Users (isActive/suspensionReason) for this page's rows — ApprovedPhone
    // and User have no formal relation, only the shared phone string, same pattern as elsewhere.
    const users = await this.db.user.findMany({
      where: { phone: { in: rows.map(ap => ap.phone) } },
      select: { phone: true, isActive: true, suspensionReason: true },
    })
    const userByPhone = new Map(users.map(u => [u.phone, u]))

    const members: MemberItemDTO[] = rows.map(ap => {
      const allSubs = ap.subscriptions
      const sub = allSubs[0] ?? null
      const user = userByPhone.get(ap.phone)
      const suspendedByUser = user ? !user.isActive : false

      let derivedStatus: MemberStatus
      if (!ap.isActive || suspendedByUser) {
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

    return { members, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
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

  private async fetchMemberDTO(approvedPhoneId: string): Promise<MemberItemDTO> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const ap = await this.db.approvedPhone.findUnique({
      where: { id: approvedPhoneId },
      include: {
        subscriptions: {
          where: { isActive: true },
          include: { community: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!ap) throw new NotFoundError('Member not found')

    const user = await this.db.user.findUnique({
      where: { phone: ap.phone },
      select: { isActive: true, suspensionReason: true },
    })

    const allSubs = ap.subscriptions
    const sub = allSubs[0] ?? null
    const suspendedByUser = user ? !user.isActive : false

    let status: MemberStatus
    if (!ap.isActive || suspendedByUser) status = 'suspended'
    else if (!ap.isRegistered) status = 'pending'
    else if (sub && new Date(sub.validUntil) < today) status = 'expired'
    else status = 'registered'

    return {
      id: ap.id,
      name: ap.name ?? '',
      phone: ap.phone,
      email: ap.email ?? '',
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

    const digits = data.phone.replace(/\D/g, '')
    const normalizedPhone =
      digits.length === 10 ? `+91${digits}`
      : digits.length === 12 && digits.startsWith('91') ? `+${digits}`
      : data.phone

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

    if (data.newCommunity) {
      const community = await this.db.community.findUnique({
        where: { id: data.newCommunity.communityId, deletedAt: null },
      })
      if (!community) throw new NotFoundError('Community not found')
      if (user) {
        const alreadyIn = await this.db.subscription.findFirst({
          where: { userId: user.id, communityId: data.newCommunity.communityId, isActive: true },
        })
        if (alreadyIn) throw new ConflictError('Member is already in this community', 'ALREADY_IN_COMMUNITY')
      }
    }

    await this.db.$transaction(async tx => {
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
      if (data.newCommunity && user) {
        const paidOn = data.newCommunity.paidOn ? new Date(data.newCommunity.paidOn) : new Date()
        await tx.subscription.create({
          data: {
            userId: user.id,
            approvedPhoneId,
            communityId: data.newCommunity.communityId,
            payment: data.newCommunity.payment,
            paidOn,
            validUntil: new Date(data.newCommunity.validUntil),
            isActive: true,
          },
        })
      }
    })

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

    await this.db.subscription.update({ where: { id: sub.id }, data: { isActive: false } })

    const remaining = await this.db.subscription.count({ where: { userId: user.id, isActive: true } })
    if (remaining === 0) {
      await this.db.$transaction(async tx => {
        await tx.approvedPhone.update({ where: { id: approvedPhoneId }, data: { isActive: false } })
        await tx.user.update({ where: { id: user.id }, data: { isActive: false } })
      })
    }

    logger.info({ approvedPhoneId, communityId, remaining }, 'admin.revokeMemberCommunity: success')
  }
}
