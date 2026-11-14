import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { addDays, istDayStart, istNow } from '../dashboard/dashboard.time.js'
import { requestLabel } from '../services/services.shared.js'

export type TransactionKind = 'community' | 'service'
export type TransactionStatus = 'paid' | 'failed' | 'flagged'

export interface TransactionFilters {
  kind?: TransactionKind
  status?: TransactionStatus
  /** A community id or a service id. */
  paidFor?: string
  /** Months of a community plan: 1, 3, 6, 12 … (services have no plan, so this leaves them out). */
  planMonths?: number
  /** IST calendar days, both included. */
  from?: string
  to?: string
  search?: string
}

export interface TransactionDTO {
  id: string
  kind: TransactionKind
  status: TransactionStatus
  occurredAt: string
  amount: number
  currency: string
  member: { id: string; name: string; email: string | null }
  paidFor: { id: string; name: string }
  /** "3 month plan" is `planMonths`; for a service it is the request and quote it paid. */
  planMonths: number | null
  planName: string | null
  reference: string | null
  paymentId: string | null
  orderId: string | null
  method: string | null
  /** Why it failed or was flagged, in words an admin can act on. */
  reason: string | null
  invoice: { id: string; number: string; downloadPath: string } | null
  /** The service request it belongs to (to open and resolve a flagged payment). */
  requestId: string | null
}

export interface TransactionListDTO {
  items: TransactionDTO[]
  page: number
  pageSize: number
  /** For the current filters (the type tabs ignore `kind`, so `counts` has all three). */
  total: number
  totalPages: number
  counts: { all: number; community: number; service: number }
}

export interface TransactionStatsDTO {
  totalCollected: { amount: number; payments: number }
  thisMonth: { amount: number; payments: number; label: string }
  successful: { count: number; ratePercent: number | null }
  failed: { count: number }
  flagged: { count: number }
}

export interface TransactionFilterOptionsDTO {
  communities: { id: string; name: string }[]
  services: { id: string; title: string }[]
  planMonths: number[]
}

interface Row {
  id: string
  kind: TransactionKind
  status: TransactionStatus
  occurred_at: Date
  amount: Prisma.Decimal
  currency: string
  user_id: string
  user_name: string
  user_email: string | null
  target_id: string
  target_name: string
  plan_months: number | null
  plan_name: string | null
  request_number: number | null
  quote_version: number | null
  payment_id: string | null
  order_id: string | null
  method: string | null
  reason: string | null
  invoice_id: string | null
  invoice_number: string | null
  request_id: string | null
}

const REASONS: Record<string, string> = {
  amount_mismatch: 'The amount paid did not match the order',
  quote_not_payable: 'The quote was no longer payable (replaced, expired or closed)',
  member_blocked: 'The member is blocked from this community',
  invoice_not_issued: 'Paid, but no invoice could be issued',
  not_applied: 'Payment received but not applied',
}

/**
 * Every payment a member made, plus every attempt that failed, across both places money comes from: plan purchases
 * (communities) and paid service quotes. Each is one row with one status:
 *   paid     the money was taken and applied
 *   failed   the attempt failed; nothing was deducted
 *   flagged  the money reached Razorpay but could not be applied (needs a refund or a look)
 * Orders that were only started, and payments Razorpay has authorized but not captured, are not payments yet.
 */
export class TransactionsService {
  constructor(private readonly db: PrismaClient) {}

  /** The two ledgers as one set of rows. `accessible` is null for a super admin, else the communities an admin manages. */
  private source(accessible: string[] | null): Prisma.Sql {
    const communityScope = accessible === null ? Prisma.empty : Prisma.sql`AND po.community_id = ANY(${accessible}::uuid[])`
    return Prisma.sql`
      SELECT
        'plan:' || po.id::text AS id,
        'community' AS kind,
        CASE po.status WHEN 'paid' THEN 'paid' ELSE 'flagged' END AS status,
        po.updated_at AS occurred_at,
        po.amount AS amount,
        po.currency AS currency,
        po.user_id AS user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        po.community_id AS target_id,
        c.name AS target_name,
        p.duration_months::int AS plan_months,
        p.name AS plan_name,
        NULL::int AS request_number,
        NULL::int AS quote_version,
        po.razorpay_payment_id AS payment_id,
        po.razorpay_order_id AS order_id,
        NULL::text AS method,
        CASE po.status WHEN 'flagged' THEN COALESCE(po.flag_reason, 'not_applied') END AS reason,
        pr.id AS invoice_id,
        pr.number AS invoice_number,
        NULL::uuid AS request_id
      FROM plan_orders po
      JOIN users u ON u.id = po.user_id
      JOIN communities c ON c.id = po.community_id
      JOIN plans p ON p.id = po.plan_id
      LEFT JOIN plan_receipts pr ON pr.plan_order_id = po.id
      -- Orders only started ('created') are not payments; 'failed' on an order is the old bad-signature mark, not a failed payment.
      WHERE po.status IN ('paid', 'flagged') ${communityScope}

      UNION ALL

      SELECT
        'planfail:' || f.id::text AS id,
        'community' AS kind,
        'failed' AS status,
        f.created_at AS occurred_at,
        f.amount AS amount,
        po.currency AS currency,
        po.user_id AS user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        po.community_id AS target_id,
        c.name AS target_name,
        p.duration_months::int AS plan_months,
        p.name AS plan_name,
        NULL::int AS request_number,
        NULL::int AS quote_version,
        f.razorpay_payment_id AS payment_id,
        po.razorpay_order_id AS order_id,
        f.method AS method,
        COALESCE(f.error_description, f.error_code) AS reason,
        NULL::uuid AS invoice_id,
        NULL::text AS invoice_number,
        NULL::uuid AS request_id
      FROM plan_payment_failures f
      JOIN plan_orders po ON po.id = f.plan_order_id
      JOIN users u ON u.id = po.user_id
      JOIN communities c ON c.id = po.community_id
      JOIN plans p ON p.id = po.plan_id
      WHERE true ${communityScope}

      UNION ALL

      SELECT
        'svc:' || rp.id::text AS id,
        'service' AS kind,
        CASE
          WHEN rp.status = 'failed' THEN 'failed'
          WHEN si.id IS NOT NULL THEN 'paid'
          -- Captured but never applied to the request (amount mismatch, quote replaced...), or applied with no invoice
          -- and still waiting on an admin.
          WHEN rp.settled_via IS NULL OR sr.requires_review THEN 'flagged'
          ELSE 'paid'
        END AS status,
        rp.created_at AS occurred_at,
        rp.amount AS amount,
        rp.currency AS currency,
        ro.user_id AS user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        sr.service_id AS target_id,
        s.title AS target_name,
        NULL::int AS plan_months,
        NULL::text AS plan_name,
        sr.number AS request_number,
        q.version AS quote_version,
        rp.razorpay_payment_id AS payment_id,
        ro.razorpay_order_id AS order_id,
        rp.method AS method,
        CASE
          WHEN rp.status = 'failed' THEN COALESCE(rp.error_description, rp.error_code)
          WHEN si.id IS NOT NULL THEN NULL
          WHEN rp.settled_via IS NULL THEN COALESCE(ev.reason, 'not_applied')
          WHEN sr.requires_review THEN 'invoice_not_issued'
        END AS reason,
        si.id AS invoice_id,
        si.number AS invoice_number,
        sr.id AS request_id
      FROM razorpay_payments rp
      JOIN razorpay_orders ro ON ro.id = rp.order_id AND ro.purpose = 'service_quote'
      JOIN service_quotes q ON q.id = ro.reference_id
      JOIN service_requests sr ON sr.id = q.request_id
      JOIN services s ON s.id = sr.service_id
      JOIN users u ON u.id = ro.user_id
      LEFT JOIN service_invoices si ON si.payment_id = rp.id
      LEFT JOIN LATERAL (
        SELECT e.meta ->> 'reason' AS reason
        FROM service_events e
        WHERE e.request_id = sr.id AND e.type = 'payment_flagged' AND e.meta ->> 'razorpayPaymentId' = rp.razorpay_payment_id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) ev ON true
      WHERE rp.status IN ('captured', 'failed')`
  }

  private conditions(f: TransactionFilters, opts: { ignoreKind?: boolean } = {}): Prisma.Sql {
    const parts: Prisma.Sql[] = []
    if (f.kind && !opts.ignoreKind) parts.push(Prisma.sql`t.kind = ${f.kind}`)
    if (f.status) parts.push(Prisma.sql`t.status = ${f.status}`)
    if (f.paidFor) parts.push(Prisma.sql`t.target_id = ${f.paidFor}::uuid`)
    if (f.planMonths) parts.push(Prisma.sql`t.plan_months = ${f.planMonths}`)
    if (f.from) {
      const [y, m, d] = f.from.split('-').map(Number) as [number, number, number]
      parts.push(Prisma.sql`t.occurred_at >= ${istDayStart(y, m, d)}`)
    }
    if (f.to) {
      // The whole of the last day: up to the start of the next one.
      const [y, m, d] = f.to.split('-').map(Number) as [number, number, number]
      const next = addDays({ year: y, month: m, day: d }, 1)
      parts.push(Prisma.sql`t.occurred_at < ${istDayStart(next.year, next.month, next.day)}`)
    }
    if (f.search) {
      const like = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`
      parts.push(
        Prisma.sql`(t.user_name ILIKE ${like} OR t.user_email ILIKE ${like} OR t.invoice_number ILIKE ${like} OR t.payment_id ILIKE ${like} OR t.order_id ILIKE ${like})`,
      )
    }
    return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty
  }

  async list(accessible: string[] | null, filters: TransactionFilters, page: number, pageSize: number): Promise<TransactionListDTO> {
    const source = this.source(accessible)
    const [kindCounts, rows] = await Promise.all([
      // The tabs show how many each type has under the other filters, so `kind` is left out here.
      this.db.$queryRaw<{ kind: TransactionKind; n: bigint }[]>`
        SELECT t.kind, count(*) AS n FROM (${source}) t ${this.conditions(filters, { ignoreKind: true })} GROUP BY t.kind`,
      this.db.$queryRaw<Row[]>`
        SELECT t.* FROM (${source}) t ${this.conditions(filters)}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ])
    const community = Number(kindCounts.find(k => k.kind === 'community')?.n ?? 0)
    const service = Number(kindCounts.find(k => k.kind === 'service')?.n ?? 0)
    const total = filters.kind === 'community' ? community : filters.kind === 'service' ? service : community + service
    return {
      items: rows.map(toDTO),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      counts: { all: community + service, community, service },
    }
  }

  /** Every row the filters match, for the CSV (capped, so one click cannot pull the whole ledger). */
  async listForExport(accessible: string[] | null, filters: TransactionFilters, cap = 20_000): Promise<TransactionDTO[]> {
    const rows = await this.db.$queryRaw<Row[]>`
      SELECT t.* FROM (${this.source(accessible)}) t ${this.conditions(filters)}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT ${cap}`
    return rows.map(toDTO)
  }

  /** The KPI tiles. Over everything the admin can see: the list's filters do not change them. */
  async stats(accessible: string[] | null, now = new Date()): Promise<TransactionStatsDTO> {
    const today = istNow(now)
    const monthStart = istDayStart(today.year, today.month, 1)
    const nextMonth = today.month === 12 ? { y: today.year + 1, m: 1 } : { y: today.year, m: today.month + 1 }
    const monthEnd = istDayStart(nextMonth.y, nextMonth.m, 1)
    const [row] = await this.db.$queryRaw<
      { paid_n: bigint; paid_sum: Prisma.Decimal | null; month_n: bigint; month_sum: Prisma.Decimal | null; failed_n: bigint; flagged_n: bigint }[]
    >`
      SELECT
        count(*) FILTER (WHERE t.status = 'paid') AS paid_n,
        sum(t.amount) FILTER (WHERE t.status = 'paid') AS paid_sum,
        count(*) FILTER (WHERE t.status = 'paid' AND t.occurred_at >= ${monthStart} AND t.occurred_at < ${monthEnd}) AS month_n,
        sum(t.amount) FILTER (WHERE t.status = 'paid' AND t.occurred_at >= ${monthStart} AND t.occurred_at < ${monthEnd}) AS month_sum,
        count(*) FILTER (WHERE t.status = 'failed') AS failed_n,
        count(*) FILTER (WHERE t.status = 'flagged') AS flagged_n
      FROM (${this.source(accessible)}) t`
    const paid = Number(row?.paid_n ?? 0)
    const failed = Number(row?.failed_n ?? 0)
    const attempts = paid + failed
    return {
      totalCollected: { amount: Number(row?.paid_sum ?? 0), payments: paid },
      thisMonth: { amount: Number(row?.month_sum ?? 0), payments: Number(row?.month_n ?? 0), label: MONTHS[today.month - 1]! },
      successful: { count: paid, ratePercent: attempts === 0 ? null : Math.round((paid / attempts) * 100) },
      failed: { count: failed },
      flagged: { count: Number(row?.flagged_n ?? 0) },
    }
  }

  /** What the filter dropdowns offer: only communities the admin manages, every service, and the plan lengths sold. */
  async filterOptions(accessible: string[] | null): Promise<TransactionFilterOptionsDTO> {
    const communityWhere: Prisma.CommunityWhereInput = { deletedAt: null, ...(accessible === null ? {} : { id: { in: accessible } }) }
    const [communities, services, plans] = await Promise.all([
      this.db.community.findMany({ where: communityWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.db.service.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
      this.db.plan.findMany({
        where: { community: communityWhere },
        select: { durationMonths: true },
        distinct: ['durationMonths'],
        orderBy: { durationMonths: 'asc' },
      }),
    ])
    return { communities, services, planMonths: plans.map(p => p.durationMonths) }
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function toDTO(r: Row): TransactionDTO {
  const reason = r.reason ? (REASONS[r.reason] ?? r.reason) : null
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    occurredAt: r.occurred_at.toISOString(),
    amount: Number(r.amount),
    currency: r.currency,
    member: { id: r.user_id, name: r.user_name, email: r.user_email },
    paidFor: { id: r.target_id, name: r.target_name },
    planMonths: r.plan_months,
    planName: r.plan_name,
    reference: r.request_number === null ? null : `${requestLabel(r.request_number)} · Quote ${r.quote_version ?? 1}`,
    paymentId: r.payment_id,
    orderId: r.order_id,
    method: r.method,
    reason,
    invoice:
      r.invoice_id && r.invoice_number
        ? {
            id: r.invoice_id,
            number: r.invoice_number,
            // The download endpoints that already exist: a plan receipt, and a service request's invoice.
            downloadPath: r.kind === 'community' ? `/api/v1/admin/receipts/${r.invoice_id}/download` : `/api/v1/admin/services/${r.request_id}/invoice`,
          }
        : null,
    requestId: r.request_id,
  }
}
