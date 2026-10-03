import { z } from 'zod'
import { MAX_POST_VIDEOS } from './posts.dto.js'

const videoInputSchema = z.object({
  kind: z.enum(['file', 'youtube', 'instagram']),
  url: z.string().url('Invalid video URL').max(1000),
  title: z.string().trim().max(300).optional(),
})

const videosSchema = z.array(videoInputSchema).max(MAX_POST_VIDEOS, `A post can have at most ${MAX_POST_VIDEOS} videos`)

export const videoPreviewSchema = z.object({ url: z.string().trim().min(1, 'url is required').max(1000) })

export const createPostSchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().min(1, 'Content is required'),
  tags: z.array(z.string().min(1).max(50)).default([]),
  imageUrls: z.array(z.string().url('Invalid image URL')).default([]),
  videos: videosSchema.default([]),
})

export const updatePostSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  imageUrls: z.array(z.string().url('Invalid image URL')).optional(),
  videos: videosSchema.optional(),
})
