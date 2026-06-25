import { z } from 'zod'

export const createCommentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(2000),
  parentCommentId: z.string().uuid('Invalid parent comment ID').optional(),
})

export const listCommentsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})
