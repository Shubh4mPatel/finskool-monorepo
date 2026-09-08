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

// Same shape/rules as auth.validator.ts's registerSchema (kept as its own
// schema rather than imported, since the two flows are expected to diverge).
export const mobileRegisterSchema = z
  .object({
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
    phone: phoneSchema,
    email: z.string().email('Invalid email address').toLowerCase(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const verifyOtpSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
})

export const resendOtpSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
})

// Same shape/rules as auth.validator.ts's loginSchema (kept as its own schema —
// see mobile-auth.service.ts's login() for why the whole flow is duplicated).
export const mobileLoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().max(255).optional(),
  deviceType: z.enum(['ios', 'android']).optional(),
})

export const mobileSelectCommunitySchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
})

export const verifyResetOtpSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
})

export const resetPasswordSchema = z
  .object({
    cypher: z.string().min(1, 'Reset session is missing or invalid'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match',
    path: ['confirmNewPassword'],
  })
