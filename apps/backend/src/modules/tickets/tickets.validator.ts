import { z } from 'zod'
import { TICKET_ATTACHMENT_MAX_BYTES } from '../../lib/minio.js'

export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_BODY_LENGTH = 2000

const categories = ['payments', 'subscription', 'account', 'content', 'app_bug', 'other'] as const
const types = ['issue', 'question', 'feature_request', 'refund_request'] as const
const statuses = ['open', 'in_progress', 'resolved'] as const

// Client-generated dedupe keys (UUIDs from the app) — bounded so they fit the DB column.
export const clientKeySchema = z.string().trim().min(8).max(64)

const attachmentRef = z.object({
  objectKey: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
})

const attachments = z.array(attachmentRef).max(MAX_ATTACHMENTS_PER_MESSAGE).default([])

export const createTicketSchema = z.object({
  communityId: z.string().uuid(),
  category: z.enum(categories),
  type: z.enum(types),
  subject: z.string().trim().min(1, 'Subject is required').max(150),
  description: z.string().trim().min(1, 'Description is required').max(MAX_BODY_LENGTH),
  attachments,
})

export const sendMessageSchema = z
  .object({
    clientMessageId: clientKeySchema,
    body: z.string().trim().max(MAX_BODY_LENGTH).optional(),
    attachments,
  })
  .refine(v => (v.body && v.body.length > 0) || v.attachments.length > 0, {
    message: 'A message needs text or at least one attachment',
    path: ['body'],
  })

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(TICKET_ATTACHMENT_MAX_BYTES, 'File must be 5 MB or smaller'),
})

export const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
})

const limit = z.coerce.number().int().min(1).max(50).default(20)

export const listTicketsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

export const listMessagesQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export const adminListTicketsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  category: z.enum(categories).optional(),
  type: z.enum(types).optional(),
  communityId: z.string().uuid().optional(),
  // One member's tickets (the "previous tickets" panel on the ticket page).
  userId: z.string().uuid().optional(),
  // 'me' | 'unassigned' | <admin uuid>
  assignee: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
  // 'true' = not resolved yet (matches the open-ticket counters in /stats)
  open: z.enum(['true', 'false']).optional(),
  unread: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

export const reassignSchema = z.object({ adminId: z.string().uuid() })

export type CreateTicketDTO = z.infer<typeof createTicketSchema>
export type SendMessageDTO = z.infer<typeof sendMessageSchema>
export type PresignDTO = z.infer<typeof presignSchema>
export type RatingDTO = z.infer<typeof ratingSchema>
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>
export type AdminListTicketsQuery = z.infer<typeof adminListTicketsQuerySchema>
