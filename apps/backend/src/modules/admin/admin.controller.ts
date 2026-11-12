import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { AdminService } from './admin.service.js'
import type { MemberListFilters } from './admin.dto.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { BadRequestError, ForbiddenError } from '../../shared/errors/index.js'

// Email is optional when an admin adds/imports a member (they may not have one on file yet —
// the member supplies/confirms a real one at self-registration, which stays required there).
// An empty-string form value is treated the same as an omitted key; if a value IS present it
// still has to look like a real email.
// Field rules shared by every form. The limits match the database columns, so an over-long value is a
// clear 400 instead of a database error, and a blank name (only spaces) is refused.
const nameSchema = (label = 'Name') => z.string().trim().min(2, `${label} must be at least 2 characters`).max(100, `${label} can be at most 100 characters`)
const phoneInput = z.string().trim().min(1, 'Phone is required').max(30, 'Phone number is too long')
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password can be at most 128 characters')
const moneySchema = z.number().positive('Payment must be a positive number').max(99_999_999, 'Payment is too large')
// YYYY-MM-DD that is a real calendar day (2030-02-30 and 2030-13-45 match a plain pattern but are not dates).
const isoDateSchema = (message: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine(v => {
    const d = new Date(`${v}T00:00:00.000Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, message)

const uuidSchema = z.string().uuid()
/** A route parameter that must be a UUID: anything else is a 400 here instead of a database error. */
function uuidParam(req: Request, name: string): string {
  const raw = req.params[name]
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new BadRequestError('Invalid id')
  return parsed.data
}

const optionalEmailSchema = z.preprocess(
  v => (v === '' ? undefined : v),
  z.string().trim().max(255, 'Email address is too long').email('Invalid email address').toLowerCase().optional(),
)

const addMemberSchema = z.object({
  phone: phoneInput,
  name: nameSchema(),
  email: optionalEmailSchema,
  communityId: z.string().uuid('Invalid community'),
  // Optional here: the free community has none of them. The service requires all three for any other community.
  payment: moneySchema.optional(),
  paidOn: isoDateSchema('Paid on must be YYYY-MM-DD').optional(),
  validUntil: isoDateSchema('Valid until must be YYYY-MM-DD').optional(),
})

const extendSubscriptionSchema = z.object({
  validUntil: isoDateSchema('Valid until must be YYYY-MM-DD'),
  payment: moneySchema,
  paidOn: isoDateSchema('Paid on must be YYYY-MM-DD').optional(),
})

const bulkDeleteMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, 'At least one member id is required'),
})

const blockMemberInCommunitySchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(1000, 'Reason is too long'),
})

const suspendMemberSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(1000, 'Reason is too long'),
})

// Shared by listMembers and exportMembersCsv — same filters, listMembers just adds
// page/pageSize on top. Four independent facts, replacing the old single 5-value
// `status` filter — see MemberListFilters' own doc comments in admin.dto.ts for
// what each one means and how registrationStatus/source relate.
const memberQueryFilterSchema = z.object({
  communityId: z.string().uuid().optional(),
  accountStatus: z.enum(['active', 'suspended', 'deleted']).optional(),
  registrationStatus: z.enum(['pending', 'registered']).optional(),
  hasActiveSubscription: z.enum(['true', 'false']).optional().transform(v => (v === undefined ? undefined : v === 'true')),
  source: z.enum(['admin', 'self']).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paidFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paidTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiringIn7Days: z.enum(['true', 'false']).optional().transform(v => (v === undefined ? undefined : v === 'true')),
  search: z.string().max(100).optional(),
})

const importQuerySchema = z.object({
  duplicateStrategy: z.enum(['skip', 'overwrite']).default('skip'),
})

const importRowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phoneInput,
  email: optionalEmailSchema,
  service: z.string().min(1),
  // 0 and an empty valid date are fine for the free community; AdminService checks a paid row has both.
  payment: z.coerce.number().min(0).max(99_999_999),
  valid: z.string(),
  paidOn: z.string().optional(),
})

const importJSONSchema = z.object({
  strategy: z.enum(['skip', 'overwrite']).default('skip'),
  rows: z.array(importRowSchema).min(1, 'At least one row required'),
  // Row numbers (matching validateImport's rowNum) the admin checked on the review
  // page to revive a suspended/deleted member — see ValidateImportRowResult.existingStatus.
  reviveRowNums: z.array(z.number().int()).default([]),
})

const validateImportRowSchema = z.object({
  rowNum: z.number().int(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  service: z.string(),
  payment: z.coerce.number(),
  valid: z.string(),
  paidOn: z.string().optional(),
})

const validateImportSchema = z.object({
  rows: z.array(validateImportRowSchema).min(1),
})

const markAllRepliedSchema = z.object({
  communityId: z.string().uuid().optional(),
})

// GET /admin/admins — the Roles & Admins tabs, search and community filter.
const listAdminsQuerySchema = z.object({
  role: z.enum(['all', 'super', 'scoped']).default('all'),
  search: z.string().trim().max(100).optional(),
  communityId: z.string().uuid().optional(),
  // Optional: without either, every match is returned (the reassign pickers need the whole team).
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

const createAdminSchema = z.object({
  name: nameSchema(),
  email: z.string().trim().max(255, 'Email address is too long').email('Invalid email address').toLowerCase(),
  phone: phoneInput,
  password: passwordSchema,
  // A repeated id is a client mistake; it is refused here rather than failing on a unique key.
  communityIds: z.array(z.string().uuid('Invalid community ID')).min(1, 'At least one community is required').refine(ids => new Set(ids).size === ids.length, 'A community is listed twice'),
})

const updateAdminAccessSchema = z.object({
  communityIds: z.array(z.string().uuid('Invalid community ID')).min(1, 'At least one community is required').refine(ids => new Set(ids).size === ids.length, 'A community is listed twice'),
})

const createCommunitySchema = z.object({
  name: z.string().min(1, 'Name is required').max(150),
  slug: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  type: z.string().min(1).max(50).optional(),
  whatsIncluded: z.array(z.string().trim().min(1, 'A point cannot be empty').max(200, 'A point is too long')).max(20, 'At most 20 points').optional(),
  coverImageUrl: z.string().url('Invalid cover image URL').optional(),
  badgeUrl: z.string().url('Invalid badge URL').optional(),
  paymentLink: z.string().url('Invalid payment link').optional(),
})

const updateCommunitySchema = z.object({
  name: z.string().min(1, 'Name is required').max(150),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  type: z.string().min(1).max(50).optional(),
  whatsIncluded: z.array(z.string().trim().min(1, 'A point cannot be empty').max(200, 'A point is too long')).max(20, 'At most 20 points').optional(),
  coverImageUrl: z.string().url('Invalid cover image URL').optional(),
  badgeUrl: z.string().url('Invalid badge URL').optional(),
  paymentLink: z.string().url('Invalid payment link').optional(),
})

const communityUploadUrlQuerySchema = z.object({
  filename: z.string().min(1, 'filename is required'),
})

const updateMemberSchema = z.object({
  name: nameSchema(),
  phone: phoneInput,
  email: optionalEmailSchema,
  newCommunity: z.object({
    communityId: z.string().uuid('Invalid community'),
    payment: moneySchema.optional(),
    paidOn: isoDateSchema('Paid on must be YYYY-MM-DD').optional(),
    validUntil: isoDateSchema('Valid until must be YYYY-MM-DD').optional(),
  }).optional(),
})

const resetMemberPasswordSchema = z.object({
  newPassword: passwordSchema,
})

const planSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  // Plan.durationMonths is a Postgres SMALLINT (max 32767) — cap here so an
  // out-of-range value fails validation with a clean 400 instead of the
  // insert throwing an unhandled Postgres error.
  durationMonths: z.number().int().positive('Duration must be a positive number of months').max(1200, 'Duration is too long'),
  price: z.number().positive('Price must be a positive number').max(10_000_000, 'Price is too large'),
})

const listNotificationsSchema = z.object({
  isReplied: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export class AdminController {
  constructor(private readonly service: AdminService) {}

  importJSON = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { strategy, rows, reviveRowNums } = importJSONSchema.parse(req.body)
      const result = await this.service.importUsersFromJSON(rows, req.user!.id, strategy, reviveRowNums, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  importCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded. Send a CSV or Excel file in the "file" field.')

      const { duplicateStrategy } = importQuerySchema.parse(req.query)
      const result = await this.service.importUsers(req.file.buffer, req.user!.id, duplicateStrategy, req.user!.accessibleCommunityIds)
      res.status(200).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommentNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isReplied, cursor, limit } = listNotificationsSchema.parse(req.query)
      const result = await this.service.listCommentNotifications(req.user!.accessibleCommunityIds, isReplied, cursor, limit)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  markNotificationReplied = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const result = await this.service.markNotificationReplied(req.user!.accessibleCommunityIds, id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  markAllNotificationsReplied = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { communityId } = markAllRepliedSchema.parse(req.body)
      const result = await this.service.markAllNotificationsReplied(req.user!.accessibleCommunityIds, communityId)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listPendingPostThreads = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schema = z.object({
        communityId: z.string().uuid().optional(),
        search: z.string().max(100).optional(),
      })
      const parsed = schema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      const result = await this.service.listPendingPostThreads(req.user!.accessibleCommunityIds, parsed.data.communityId, parsed.data.search)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  // GET /admin/members/stats: the Members page cards (total / registered / pending) in one call. Scoped like the list.
  memberStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const accessible = req.user!.accessibleCommunityIds
      const result = await this.service.getMemberStats(accessible !== null ? { communityIds: accessible } : {})
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schema = memberQueryFilterSchema.extend({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(8),
      })
      const parsed = schema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')

      const accessible = req.user!.accessibleCommunityIds
      let filters: MemberListFilters = parsed.data
      if (accessible !== null) {
        if (filters.communityId) {
          if (!accessible.includes(filters.communityId)) {
            throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
          }
        } else {
          filters = { ...filters, communityIds: accessible }
        }
      }

      const result = await this.service.listMembers(filters)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  // Deliberately no accessibleCommunityIds scoping here (unlike listMembers above) — any
  // admin, scoped or super, can export members across every community, by product decision.
  exportMembersCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = memberQueryFilterSchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')

      const csv = await this.service.exportMembersCsv(parsed.data)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="members-export-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.status(200).send(csv)
    } catch (err) {
      next(err)
    }
  }

  validateImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rows } = validateImportSchema.parse(req.body)
      const result = await this.service.validateImport(rows, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommunities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listCommunities(req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  createCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createCommunitySchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.createCommunity(req.user!.id, parsed.data)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  getCommunityUploadUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { filename } = communityUploadUrlQuerySchema.parse(req.query)
      const urls = await this.service.getCommunityUploadUrl(filename)
      res.json({ success: true, data: urls })
    } catch (err) {
      next(err)
    }
  }

  updateCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const parsed = updateCommunitySchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.updateCommunity(req.user!.id, id, parsed.data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  deleteCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      await this.service.deleteCommunity(req.user!.id, id)
      res.json({ success: true, message: 'Community deleted' })
    } catch (err) {
      next(err)
    }
  }

  listPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = uuidParam(req, 'communityId')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, communityId)
      const result = await this.service.listPlans(communityId)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  createPlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = uuidParam(req, 'communityId')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, communityId)
      const parsed = planSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.createPlan(communityId, parsed.data, req.user!.id)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  updatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = uuidParam(req, 'communityId')
      const planId = uuidParam(req, 'planId')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, communityId)
      const parsed = planSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.updatePlan(communityId, planId, parsed.data, req.user!.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  deletePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = uuidParam(req, 'communityId')
      const planId = uuidParam(req, 'planId')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, communityId)
      await this.service.deletePlan(communityId, planId, req.user!.id)
      res.json({ success: true, message: 'Plan deleted' })
    } catch (err) {
      next(err)
    }
  }

  listAdmins = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = listAdminsQuerySchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      const result = await this.service.listAdmins(req.user!.id, parsed.data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  grantCommunityAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = uuidParam(req, 'adminId')
      const parsed = z.object({ communityId: z.string().uuid('Invalid community') }).safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      await this.service.grantCommunityAccess(req.user!.id, adminId, parsed.data.communityId)
      res.status(201).json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  revokeCommunityAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = uuidParam(req, 'adminId')
      const communityId = uuidParam(req, 'communityId')
      await this.service.revokeCommunityAccess(req.user!.id, adminId, communityId)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = addMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, parsed.data.communityId)
      const result = await this.service.addMember(parsed.data, req.user!.id, req.user!.accessibleCommunityIds)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  // Reached only after the admin confirms the MEMBER_REVIVE_REQUIRED prompt from
  // addMember above — same request shape, resubmitted as-is.
  reviveAndAddMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = addMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, parsed.data.communityId)
      const result = await this.service.reviveAndAddMember(parsed.data, req.user!.id, req.user!.accessibleCommunityIds)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  extendSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const parsed = extendSubscriptionSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.extendSubscription(id, parsed.data, req.user!.accessibleCommunityIds)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  deleteMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const result = await this.service.deleteMember(id, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  bulkDeleteMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = bulkDeleteMembersSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.bulkDeleteMembers(parsed.data.userIds, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  suspendMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const parsed = suspendMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.suspendMember(id, parsed.data.reason, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  blockMemberInCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const communityId = uuidParam(req, 'communityId')
      const parsed = blockMemberInCommunitySchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.blockMemberInCommunity(id, communityId, parsed.data.reason, req.user!.id, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  unblockMemberInCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const communityId = uuidParam(req, 'communityId')
      const result = await this.service.unblockMemberInCommunity(id, communityId, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  revokeSuspension = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const result = await this.service.revokeSuspension(id, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  createAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createAdminSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.createAdmin(req.user!.id, parsed.data)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  updateAdminAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = uuidParam(req, 'adminId')
      const parsed = updateAdminAccessSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.updateAdminAccess(req.user!.id, adminId, parsed.data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  deleteAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = uuidParam(req, 'adminId')
      await this.service.deleteAdmin(req.user!.id, adminId)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  updateMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const parsed = updateMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.updateMember(id, parsed.data, req.user!.id, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  getMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const result = await this.service.getMemberById(id, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  resetMemberPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const parsed = resetMemberPasswordSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.resetMemberPassword(id, parsed.data.newPassword, req.user!.accessibleCommunityIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  revokeMemberCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = uuidParam(req, 'id')
      const communityId = uuidParam(req, 'communityId')
      assertCommunityAccessFromToken(req.user!.accessibleCommunityIds, communityId)
      await this.service.revokeMemberCommunity(id, communityId)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }
}
