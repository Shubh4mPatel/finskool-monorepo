import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../../lib/prisma.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import { BadRequestError } from '../../shared/errors/index.js'
import { TransactionsService } from './transactions.service.js'
import type { TransactionDTO, TransactionFilters } from './transactions.service.js'
import { transactionsToCsv } from './transactions.csv.js'
import { transactionsToXlsx } from './transactions.xlsx.js'

// /api/v1/admin/transactions: every payment made for communities and services, with its invoice, and the ones that
// failed or could not be applied. Community payments are limited to the communities the admin manages (a super admin
// sees all); services are global, like the rest of the Services module.
const service = new TransactionsService(prisma)
const router = Router()
router.use(authenticate, requireRole('admin'))

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD')

const filterSchema = z.object({
  type: z.enum(['communities', 'services']).optional(),
  status: z.enum(['paid', 'failed', 'flagged']).optional(),
  paidFor: z.string().uuid().optional(),
  plan: z.coerce.number().int().min(1).max(120).optional(),
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(100).optional(),
})
const listSchema = filterSchema.extend({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
})

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next)
}

function parse<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query)
  if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
  return parsed.data
}

function toFilters(q: z.infer<typeof filterSchema>): TransactionFilters {
  if (q.from && q.to && q.from > q.to) throw new BadRequestError('"from" is after "to"')
  return {
    ...(q.type ? { kind: q.type === 'communities' ? ('community' as const) : ('service' as const) } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.paidFor ? { paidFor: q.paidFor } : {}),
    ...(q.plan ? { planMonths: q.plan } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    ...(q.search ? { search: q.search } : {}),
  }
}

/**
 * @openapi
 * /admin/transactions:
 *   get:
 *     tags: [Payments]
 *     summary: All transactions (paid, failed and flagged), newest first
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [communities, services] } }
 *       - { in: query, name: status, schema: { type: string, enum: [paid, failed, flagged] } }
 *       - { in: query, name: paidFor, description: A community or service id, schema: { type: string, format: uuid } }
 *       - { in: query, name: plan, description: Plan length in months, schema: { type: integer } }
 *       - { in: query, name: from, description: First day (IST), schema: { type: string, format: date } }
 *       - { in: query, name: to, description: Last day (IST), schema: { type: string, format: date } }
 *       - { in: query, name: search, description: Member name or email, invoice number, payment or order id, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 10, maximum: 100 } }
 *     responses:
 *       200: { description: "{ success, data: { items, page, pageSize, total, totalPages, counts: { all, community, service } } }" }
 */
router.get('/', wrap(async (req, res) => {
  const { page, pageSize, ...rest } = parse(listSchema, req.query)
  res.json({ success: true, data: await service.list(req.user!.accessibleCommunityIds, toFilters(rest), page, pageSize) })
}))

/**
 * @openapi
 * /admin/transactions/stats:
 *   get:
 *     tags: [Payments]
 *     summary: KPI tiles (all time, this month, success rate, failed, flagged)
 *     responses:
 *       200: { description: "{ success, data: { totalCollected, thisMonth, successful, failed, flagged } }" }
 */
router.get('/stats', wrap(async (req, res) => {
  res.json({ success: true, data: await service.stats(req.user!.accessibleCommunityIds) })
}))

/**
 * @openapi
 * /admin/transactions/filters:
 *   get:
 *     tags: [Payments]
 *     summary: What the "Paid for" and "Plan" filters can be set to
 *     responses:
 *       200: { description: "{ success, data: { communities, services, planMonths } }" }
 */
router.get('/filters', wrap(async (req, res) => {
  res.json({ success: true, data: await service.filterOptions(req.user!.accessibleCommunityIds) })
}))

/**
 * @openapi
 * /admin/transactions/export:
 *   get:
 *     tags: [Payments]
 *     summary: The same list as a CSV (same filters, no paging)
 *     responses:
 *       200: { description: text/csv }
 */
router.get('/export', wrap(async (req, res) => {
  const items: TransactionDTO[] = await service.listForExport(req.user!.accessibleCommunityIds, toFilters(parse(filterSchema, req.query)))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.status(200).send(transactionsToCsv(items))
}))

/**
 * @openapi
 * /admin/transactions/export/xlsx:
 *   get:
 *     tags: [Payments]
 *     summary: The same list as an Excel file (same filters as the list, no paging)
 *     description: Amounts are numbers and dates are real dates, so the file can be summed, sorted and filtered in Excel. At most 20,000 rows.
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [communities, services] } }
 *       - { in: query, name: status, schema: { type: string, enum: [paid, failed, flagged] } }
 *       - { in: query, name: paidFor, schema: { type: string, format: uuid } }
 *       - { in: query, name: plan, schema: { type: integer } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: "An .xlsx file (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)" }
 */
router.get('/export/xlsx', wrap(async (req, res) => {
  const items: TransactionDTO[] = await service.listForExport(req.user!.accessibleCommunityIds, toFilters(parse(filterSchema, req.query)))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.xlsx"`)
  res.status(200).send(transactionsToXlsx(items))
}))

export default router
