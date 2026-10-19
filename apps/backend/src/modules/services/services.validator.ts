import { z } from 'zod'
import { MAX_BODY_LENGTH } from '../tickets/tickets.validator.js'

// Chat bodies, attachments, ratings, paging and presign share their rules with the ticket module.
export {
  clientKeySchema,
  listMessagesQuerySchema,
  presignSchema,
  ratingSchema,
  reassignSchema,
  sendMessageSchema,
} from '../tickets/tickets.validator.js'
export type { ListMessagesQuery, PresignDTO, RatingDTO, SendMessageDTO } from '../tickets/tickets.validator.js'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../tickets/tickets.validator.js'

const statuses = ['requested', 'quote_sent', 'paid', 'closed'] as const

const attachmentRef = z.object({
  objectKey: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
})

export const createServiceRequestSchema = z.object({
  serviceId: z.string().uuid(),
  needs: z.string().trim().min(1, 'Please describe what you need').max(MAX_BODY_LENGTH),
  attachments: z.array(attachmentRef).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
})

const limit = z.coerce.number().int().min(1).max(50).default(20)

export const listServiceRequestsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

export const adminListServiceRequestsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  // 'true' = not closed yet (matches the open-request counters in /stats)
  open: z.enum(['true', 'false']).optional(),
  serviceId: z.string().uuid().optional(),
  // One member's requests
  userId: z.string().uuid().optional(),
  // 'me' | 'unassigned' | <admin uuid>
  assignee: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
  unread: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

// ─── Catalog ────────────────────────────────────────────────────────────────

const imageUrl = z.string().trim().url().max(500)

export const createCatalogServiceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(5000),
  imageUrl: imageUrl.nullish(),
  isActive: z.boolean().default(true),
})

export const updateCatalogServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    imageUrl: imageUrl.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

export const catalogImagePresignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
})

export type CreateServiceRequestDTO = z.infer<typeof createServiceRequestSchema>
export type ListServiceRequestsQuery = z.infer<typeof listServiceRequestsQuerySchema>
export type AdminListServiceRequestsQuery = z.infer<typeof adminListServiceRequestsQuerySchema>
export type CreateCatalogServiceDTO = z.infer<typeof createCatalogServiceSchema>
export type UpdateCatalogServiceDTO = z.infer<typeof updateCatalogServiceSchema>
