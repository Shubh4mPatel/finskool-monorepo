import { z } from 'zod'

export const createPostSchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().min(1, 'Content is required'),
  tags: z
    .union([
      z.array(z.string().min(1).max(50)),
      z.string().transform((s, ctx) => {
        try {
          const parsed = JSON.parse(s)
          if (!Array.isArray(parsed)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be a JSON array' })
            return z.NEVER
          }
          return parsed as string[]
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be valid JSON array' })
          return z.NEVER
        }
      }),
    ])
    .default([]),
})

export const updatePostSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).optional(),
  tags: z
    .union([
      z.array(z.string().min(1).max(50)),
      z.string().transform((s, ctx) => {
        try {
          const parsed = JSON.parse(s)
          if (!Array.isArray(parsed)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be a JSON array' })
            return z.NEVER
          }
          return parsed as string[]
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be valid JSON array' })
          return z.NEVER
        }
      }),
    ])
    .optional(),
})

export const pinPostSchema = z.object({
  pinOrder: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
})
