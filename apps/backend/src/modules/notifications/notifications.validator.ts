import { z } from 'zod'

export const listNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  communityId: z.string().uuid().optional(),
  // Opaque, from a previous response's `nextCursor`. When present the list continues after that item and `page` is
  // ignored. Paging by cursor is what the app should use: page numbers shift when new notifications arrive.
  cursor: z.string().min(1).max(200).optional(),
  // The admin page: all unread first (newest to oldest), then the read ones. The mobile app does not send it.
  unreadFirst: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
})

// The id comes from the URL; a value that is not a UUID would otherwise reach the database and fail there as a 500.
export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification id'),
})
