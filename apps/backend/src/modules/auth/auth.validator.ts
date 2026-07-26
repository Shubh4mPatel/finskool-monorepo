import { z } from 'zod'
import { normalizePhone } from '../../lib/phone.js'

const phoneSchema = z.string().transform((val, ctx) => {
  const normalized = normalizePhone(val)
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' })
    return z.NEVER
  }
  return normalized
})

export const registerSchema = z
  .object({
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
    phone: phoneSchema,
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
})

export const updateEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const updateNameSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match',
    path: ['confirmNewPassword'],
  })

export const updateNotificationsSchema = z.object({
  postNotificationsEnabled: z.boolean(),
})

export const updateAvatarSchema = z.object({
  avatarUrl: z.string().url('Invalid avatar URL'),
})
