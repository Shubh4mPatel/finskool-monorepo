import { z } from 'zod'

export const createPostSchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().min(1, 'Content is required'),
  tags: z.array(z.string().min(1).max(50)).default([]),
  imageUrls: z.array(z.string().url('Invalid image URL')).default([]),
})

export const updatePostSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  imageUrls: z.array(z.string().url('Invalid image URL')).optional(),
})

export const pinPostSchema = z.object({
  pinOrder: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
})
