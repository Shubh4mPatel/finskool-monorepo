import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { AdminService } from './admin.service.js'
import { BadRequestError } from '../../shared/errors/index.js'

const addMemberSchema = z.object({
  phone: z.string().min(10, 'Phone is required'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  communityId: z.string().uuid('Invalid community'),
  payment: z.number().positive('Payment must be a positive number'),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid until must be YYYY-MM-DD'),
})

const extendSubscriptionSchema = z.object({
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid until must be YYYY-MM-DD'),
  payment: z.number().positive('Payment must be a positive number'),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Paid on must be YYYY-MM-DD').optional(),
})

const bulkDeleteMembersSchema = z.object({
  approvedPhoneIds: z.array(z.string().uuid()).min(1, 'At least one member id is required'),
})

const suspendMemberSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(1000, 'Reason is too long'),
})

const importQuerySchema = z.object({
  duplicateStrategy: z.enum(['skip', 'overwrite']).default('skip'),
})

const importRowSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  service: z.string().min(1),
  payment: z.coerce.number().positive(),
  valid: z.string().min(1),
  paidOn: z.string().optional(),
})

const importJSONSchema = z.object({
  strategy: z.enum(['skip', 'overwrite']).default('skip'),
  rows: z.array(importRowSchema).min(1, 'At least one row required'),
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
      const { strategy, rows } = importJSONSchema.parse(req.body)
      const result = await this.service.importUsersFromJSON(rows, req.user!.id, strategy)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  getDashboard = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.getDashboard()
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  importCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded. Send a CSV or Excel file in the "file" field.')

      const { duplicateStrategy } = importQuerySchema.parse(req.query)
      const result = await this.service.importUsers(req.file.buffer, req.user!.id, duplicateStrategy)
      res.status(200).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommentNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isReplied, cursor, limit } = listNotificationsSchema.parse(req.query)
      const result = await this.service.listCommentNotifications(isReplied, cursor, limit)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  markNotificationReplied = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const result = await this.service.markNotificationReplied(id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  markAllNotificationsReplied = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { communityId } = markAllRepliedSchema.parse(req.body)
      const result = await this.service.markAllNotificationsReplied(communityId)
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
      const result = await this.service.listPendingPostThreads(parsed.data.communityId, parsed.data.search)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schema = z.object({
        communityId: z.string().uuid().optional(),
        status: z.enum(['registered', 'pending', 'expired', 'suspended']).optional(),
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        paidFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        paidTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        search: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(8),
      })
      const parsed = schema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      const result = await this.service.listMembers(parsed.data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  validateImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rows } = validateImportSchema.parse(req.body)
      const result = await this.service.validateImport(rows)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommunities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listCommunities()
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = addMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.addMember(parsed.data, req.user!.id)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  extendSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const parsed = extendSubscriptionSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.extendSubscription(id, parsed.data)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  deleteMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const result = await this.service.deleteMember(id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  bulkDeleteMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = bulkDeleteMembersSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.bulkDeleteMembers(parsed.data.approvedPhoneIds)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  suspendMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const parsed = suspendMemberSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.suspendMember(id, parsed.data.reason)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  revokeSuspension = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const result = await this.service.revokeSuspension(id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
