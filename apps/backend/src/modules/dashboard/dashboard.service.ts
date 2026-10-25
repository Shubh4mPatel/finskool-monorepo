import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { BadRequestError } from '../../shared/errors/index.js'
import { ticketLabel } from '../tickets/tickets.shared.js'
import { requestLabel } from '../services/services.shared.js'
import type {
  DashboardExpiringDTO,
  DashboardKpisDTO,
  DashboardRegistrationsDTO,
  DashboardRevenueDTO,
  DashboardTicketItemDTO,
  DashboardTicketsDTO,
  RevenuePointDTO,
  TicketStatusTone,
} from './dashboard.dto.js'
import {
  addDays,
  calendarDate,
  dateString,
  daysInMonth,
  initials,
  istDayStart,
  istNow,
  monthString,
  previousMonth,
} from './dashboard.time.js'

export const EXPIRING_WINDOW_DAYS = 7

export interface DashboardViewer {
  /** null = unrestricted (super admin); otherwise exactly the communities this admin manages. */
  accessibleCommunityIds: string[] | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const deltaPercent = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null

export class DashboardService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ─── 1. KPI cards ──────────────────────────────────────────────────────────

  async getKpis(viewer: DashboardViewer): Promise<DashboardKpisDTO> {
    const now = this.clock()
    const today = istNow(now)
    const monthStart = istDayStart(today.year, today.month, 1)
    const todayDate = calendarDate(today.year, today.month, today.day)
    const ids = viewer.accessibleCommunityIds

    const subScope = ids === null ? {} : { communityId: { in: ids } }
    // A member "belongs" to an admin when they have a subscription row in one of that admin's
    // communities — the same rule the member roster and every member action use.
    const memberScope = ids === null ? {} : { subscriptions: { some: subScope } }
    const member = { role: 'member', deletedAt: null, ...memberScope } as const

    const monthFrom = dateString(today.year, today.month, 1)
    const monthTo = dateString(today.year, today.month, today.day)
    const prev = previousMonth(today.year, today.month)
    const prevTo = dateString(prev.year, prev.month, Math.min(today.day, daysInMonth(prev.year, prev.month)))

    const [
      totalMembers,
      newThisMonth,
      activeSubscriptions,
      pendingRegistration,
      current,
      previous,
      openTickets,
      openEnquiries,
      ticketsAwaiting,
      enquiriesAwaiting,
    ] = await Promise.all([
      this.db.user.count({ where: member }),
      this.db.user.count({ where: { ...member, createdAt: { gte: monthStart } } }),
      // Free-tier rows aren't "subscriptions" in the business sense (every member has one).
      this.db.subscription.count({
        where: {
          isActive: true,
          validUntil: { gte: todayDate },
          community: { isFree: false },
          user: { passwordHash: { not: null }, status: 'active', deletedAt: null },
          ...subScope,
        },
      }),
      this.db.user.count({ where: { ...member, passwordHash: null, status: 'active' } }),
      this.revenueTotal(ids, monthFrom, monthTo),
      this.revenueTotal(ids, dateString(prev.year, prev.month, 1), prevTo),
      this.db.ticket.count({ where: { status: { not: 'resolved' }, ...this.ticketScope(ids) } }),
      // Service requests aren't tied to a community: every admin sees all of them.
      this.db.serviceRequest.count({ where: { status: { not: 'closed' } } }),
      this.db.ticket.count({
        where: { status: { not: 'resolved' }, messages: { none: { senderRole: 'admin' } }, ...this.ticketScope(ids) },
      }),
      this.db.serviceRequest.count({
        where: { status: { not: 'closed' }, messages: { none: { senderRole: 'admin' } } },
      }),
    ])

    return {
      totalMembers: { value: totalMembers, newThisMonth },
      activeSubscriptions: { value: activeSubscriptions, pendingRegistration },
      revenue: {
        amount: current,
        previousAmount: previous,
        deltaPercent: deltaPercent(current, previous),
        from: monthFrom,
        through: monthTo,
      },
      tickets: { openTickets, openEnquiries, awaitingFirstReply: ticketsAwaiting + enquiriesAwaiting },
    }
  }

  // ─── 2. Revenue chart ──────────────────────────────────────────────────────

  async getRevenue(viewer: DashboardViewer, month: string | undefined): Promise<DashboardRevenueDTO> {
    const today = istNow(this.clock())
    const [year, mon] = month ? month.split('-').map(Number) as [number, number] : [today.year, today.month]

    const isFuture = year > today.year || (year === today.year && mon > today.month)
    if (isFuture) throw new BadRequestError('Cannot show revenue for a future month')

    const isRunningMonth = year === today.year && mon === today.month
    const throughDay = isRunningMonth ? today.day : daysInMonth(year, mon)
    const prev = previousMonth(year, mon)
    const prevThrough = Math.min(throughDay, daysInMonth(prev.year, prev.month))

    const [currentByDay, previousByDay] = await Promise.all([
      this.revenueByDay(viewer.accessibleCommunityIds, dateString(year, mon, 1), dateString(year, mon, throughDay)),
      this.revenueByDay(
        viewer.accessibleCommunityIds,
        dateString(prev.year, prev.month, 1),
        dateString(prev.year, prev.month, prevThrough),
      ),
    ])

    const series = (y: number, m: number, through: number, byDay: Map<string, number>): RevenuePointDTO[] =>
      Array.from({ length: through }, (_, i) => {
        const date = dateString(y, m, i + 1)
        return { day: i + 1, date, amount: byDay.get(date) ?? 0 }
      })

    const current = series(year, mon, throughDay, currentByDay)
    const previous = series(prev.year, prev.month, prevThrough, previousByDay)
    const totalCurrent = round2(current.reduce((s, p) => s + p.amount, 0))
    const totalPrevious = round2(previous.reduce((s, p) => s + p.amount, 0))

    return {
      month: monthString(year, mon),
      previousMonth: monthString(prev.year, prev.month),
      throughDay,
      current,
      previous,
      totalCurrent,
      totalPrevious,
      deltaPercent: deltaPercent(totalCurrent, totalPrevious),
    }
  }

  // ─── 3. Expiring soon ──────────────────────────────────────────────────────

  async getExpiring(viewer: DashboardViewer, limit: number): Promise<DashboardExpiringDTO> {
    const today = istNow(this.clock())
    const end = addDays(today, EXPIRING_WINDOW_DAYS)
    const todayDate = calendarDate(today.year, today.month, today.day)
    const ids = viewer.accessibleCommunityIds

    const where: Prisma.SubscriptionWhereInput = {
      isActive: true,
      validUntil: { gte: todayDate, lte: calendarDate(end.year, end.month, end.day) },
      // The free tier expires in ~100 years, but never belongs on a renewals list regardless.
      community: { isFree: false },
      user: { role: 'member', status: 'active', deletedAt: null },
      ...(ids === null ? {} : { communityId: { in: ids } }),
    }

    const [rows, total] = await Promise.all([
      this.db.subscription.findMany({
        where,
        orderBy: [{ validUntil: 'asc' }, { id: 'asc' }],
        take: limit,
        select: {
          id: true,
          validUntil: true,
          communityId: true,
          community: { select: { name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      this.db.subscription.count({ where }),
    ])

    return {
      windowDays: EXPIRING_WINDOW_DAYS,
      total,
      items: rows.map(s => ({
        subscriptionId: s.id,
        userId: s.user.id,
        name: s.user.name,
        initials: initials(s.user.name),
        communityId: s.communityId,
        communityName: s.community.name,
        validUntil: s.validUntil.toISOString().slice(0, 10),
        daysLeft: Math.round((s.validUntil.getTime() - todayDate.getTime()) / 86_400_000),
      })),
    }
  }

  // ─── 4. New registrations ──────────────────────────────────────────────────

  async getRegistrations(viewer: DashboardViewer, limit: number): Promise<DashboardRegistrationsDTO> {
    const ids = viewer.accessibleCommunityIds
    const subScope = ids === null ? {} : { communityId: { in: ids } }
    const where: Prisma.UserWhereInput = {
      role: 'member',
      deletedAt: null,
      // Deleted accounts aren't registrations anyone cares about; suspended ones still show.
      status: { not: 'deleted' },
      ...(ids === null ? {} : { subscriptions: { some: subScope } }),
    }
    const weekAgo = new Date(this.clock().getTime() - 7 * 86_400_000)

    const [users, last7DaysCount] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          status: true,
          passwordHash: true,
          createdAt: true,
          // Only a community this admin can see — never leak another community's name.
          subscriptions: {
            where: { community: { isFree: false }, ...subScope },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { community: { select: { name: true } } },
          },
        },
      }),
      this.db.user.count({ where: { ...where, createdAt: { gte: weekAgo } } }),
    ])

    // User and ApprovedPhone aren't related in the schema; an ApprovedPhone row is what marks a
    // member as admin-added (same rule as the member roster's `source`).
    const approved = await this.db.approvedPhone.findMany({
      where: { phone: { in: users.map(u => u.phone) } },
      select: { phone: true },
    })
    const adminAdded = new Set(approved.map(a => a.phone))

    return {
      last7DaysCount,
      items: users.map(u => ({
        userId: u.id,
        name: u.name,
        initials: initials(u.name),
        phone: u.phone,
        email: u.email,
        registeredAt: u.createdAt.toISOString(),
        source: adminAdded.has(u.phone) ? 'admin' : 'self',
        communityName: u.subscriptions[0]?.community.name ?? null,
        accountStatus: u.status === 'suspended' ? 'suspended' : 'active',
        registrationStatus: u.passwordHash ? 'registered' : 'pending',
      })),
    }
  }

  // ─── 5. Recent tickets ─────────────────────────────────────────────────────

  async getRecentTickets(viewer: DashboardViewer, limit: number): Promise<DashboardTicketsDTO> {
    const adminReply = { where: { senderRole: 'admin' as const }, take: 1, select: { id: true } }

    // Each source is cut to `limit` first, so the merged top `limit` is exact without
    // loading either table.
    const [tickets, requests] = await Promise.all([
      this.db.ticket.findMany({
        where: this.ticketScope(viewer.accessibleCommunityIds),
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          lastMessageAt: true,
          user: { select: { id: true, name: true } },
          messages: adminReply,
        },
      }),
      this.db.serviceRequest.findMany({
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          number: true,
          status: true,
          lastMessageAt: true,
          user: { select: { id: true, name: true } },
          service: { select: { title: true } },
          messages: adminReply,
        },
      }),
    ])

    const items: (Omit<DashboardTicketItemDTO, 'lastUpdateAt'> & { lastUpdateAt: Date })[] = [
      ...tickets.map(t => ({
        id: t.id,
        kind: 'support' as const,
        label: ticketLabel(t.number),
        member: { id: t.user.id, name: t.user.name, initials: initials(t.user.name) },
        typeLabel: 'Support',
        subject: t.subject,
        status: this.ticketStatus(t.status, t.messages.length > 0),
        lastUpdateAt: t.lastMessageAt,
      })),
      ...requests.map(r => ({
        id: r.id,
        kind: 'service' as const,
        label: requestLabel(r.number),
        member: { id: r.user.id, name: r.user.name, initials: initials(r.user.name) },
        typeLabel: 'Service enquiry',
        subject: r.service.title,
        status: this.serviceStatus(r.status, r.messages.length > 0),
        lastUpdateAt: r.lastMessageAt,
      })),
    ]
      .sort((a, b) => b.lastUpdateAt.getTime() - a.lastUpdateAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)

    return { items: items.map(i => ({ ...i, lastUpdateAt: i.lastUpdateAt.toISOString() })) }
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private ticketScope(ids: string[] | null): Prisma.TicketWhereInput {
    return ids === null ? {} : { communityId: { in: ids } }
  }

  // The dashboard's own display vocabulary. Neither source has a "replied" state, so it's
  // derived from whether an admin has ever answered.
  private ticketStatus(
    status: 'open' | 'in_progress' | 'resolved',
    hasAdminReply: boolean,
  ): { key: string; label: string; tone: TicketStatusTone } {
    if (status === 'resolved') return { key: 'resolved', label: 'Resolved', tone: 'neutral' }
    if (status === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'info' }
    return hasAdminReply
      ? { key: 'replied', label: 'Replied', tone: 'success' }
      : { key: 'new', label: 'New', tone: 'danger' }
  }

  private serviceStatus(
    status: 'requested' | 'quote_sent' | 'paid' | 'closed',
    hasAdminReply: boolean,
  ): { key: string; label: string; tone: TicketStatusTone } {
    switch (status) {
      case 'closed':
        return { key: 'closed', label: 'Closed', tone: 'neutral' }
      case 'paid':
        return { key: 'paid', label: 'Paid', tone: 'success' }
      case 'quote_sent':
        return { key: 'quote_sent', label: 'Quote sent', tone: 'info' }
      default:
        return hasAdminReply
          ? { key: 'replied', label: 'Replied', tone: 'success' }
          : { key: 'new', label: 'New', tone: 'danger' }
    }
  }

  private async revenueTotal(ids: string[] | null, from: string, to: string): Promise<number> {
    const byDay = await this.revenueByDay(ids, from, to)
    return round2([...byDay.values()].reduce((s, n) => s + n, 0))
  }

  /**
   * Money collected per IST calendar day in [from, to] (inclusive, YYYY-MM-DD).
   *
   * - Subscriptions: `payment` on the day it was paid. Every row counts, including ones since
   *   superseded by a renewal or deactivated — that money was still collected. Rows with no
   *   `paid_on` (some bulk imports) fall back to the day they were created. Free-tier rows are 0.
   * - Services: the invoice total on the day it was issued. Service requests aren't tied to a
   *   community, so this is company-wide income and only super admins (ids === null) see it.
   */
  private async revenueByDay(ids: string[] | null, from: string, to: string): Promise<Map<string, number>> {
    const totals = new Map<string, number>()
    const add = (rows: { day: string; amount: Prisma.Decimal | string | number | null }[]): void => {
      for (const r of rows) totals.set(r.day, round2((totals.get(r.day) ?? 0) + Number(r.amount ?? 0)))
    }

    if (ids !== null && ids.length === 0) return totals

    const communityFilter =
      ids === null
        ? Prisma.empty
        : Prisma.sql`AND s.community_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`

    add(
      await this.db.$queryRaw<{ day: string; amount: Prisma.Decimal }[]>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day, SUM(d.payment) AS amount
        FROM (
          SELECT s.payment,
                 COALESCE(s.paid_on, (s.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS day
          FROM subscriptions s
          WHERE s.payment > 0 ${communityFilter}
        ) d
        WHERE d.day BETWEEN ${from}::date AND ${to}::date
        GROUP BY d.day
      `,
    )

    if (ids === null) {
      add(
        await this.db.$queryRaw<{ day: string; amount: Prisma.Decimal }[]>`
          SELECT to_char(d.day, 'YYYY-MM-DD') AS day, SUM(d.total) AS amount
          FROM (
            SELECT i.total, (i.issued_at AT TIME ZONE 'Asia/Kolkata')::date AS day
            FROM service_invoices i
          ) d
          WHERE d.day BETWEEN ${from}::date AND ${to}::date
          GROUP BY d.day
        `,
      )
    }

    return totals
  }
}
