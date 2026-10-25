import { z } from 'zod'

// FCM registration tokens are ~150-200 chars of [A-Za-z0-9_:-]; allow headroom.
export const fcmTokenSchema = z.string().trim().min(20).max(512).regex(/^[\w:.\-]+$/, 'Invalid device token')

export const registerPushTokenSchema = z.object({
  token: fcmTokenSchema,
  platform: z.enum(['ios', 'android']).optional(),
  appVersion: z.string().trim().max(32).optional(),
})

export const pushSettingsSchema = z.object({ pushEnabled: z.boolean() })
