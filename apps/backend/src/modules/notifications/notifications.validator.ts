import { z } from 'zod'

export const listNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  communityId: z.string().uuid().optional(),
})

// The id comes from the URL; a value that is not a UUID would otherwise reach the database and fail there as a 500.
export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification id'),
})
