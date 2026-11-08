import { z } from 'zod'
import { normalizePhone } from '../../lib/phone.js'
import { fcmTokenSchema } from '../push/push.validator.js'

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

// What the app tells us about the phone and where it is, for the "new login" email ("Pixel 8 from Mumbai, India").
// Both optional and only ever displayed (HTML-escaped in the email), never used for any decision.
const deviceNameField = z.string().trim().max(100).optional()
const locationField = z.string().trim().max(120).optional()

// Same shape/rules as auth.validator.ts's loginSchema (kept as its own schema —
// see mobile-auth.service.ts's login() for why the whole flow is duplicated).
export const mobileLoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().max(255).optional(),
  deviceType: z.enum(['ios', 'android']).optional(),
  deviceName: deviceNameField,
  location: locationField,
  // Lets the first push work right after login without a second call.
  fcmToken: fcmTokenSchema.optional(),
  appVersion: z.string().trim().max(32).optional(),
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

// Indian PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Input is trimmed and
// upper-cased before the check, so " abcde1234f " is accepted and stored normalised.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

const dateOfBirthField = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .superRefine((value, ctx) => {
      // Round-trip catches impossible dates like 2026-02-30, which Date() would roll forward.
      const parsed = new Date(`${value}T00:00:00.000Z`)
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid date of birth' })
        return
      }
      if (value > new Date().toISOString().slice(0, 10)) {
        ctx.addIssue({ code: 'custom', message: 'Date of birth cannot be in the future' })
      } else if (value < '1900-01-01') {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid date of birth' })
      }
    })
const panField = z.string().trim().toUpperCase().regex(PAN_REGEX, 'Enter a valid PAN, e.g. ABCDE1234F')

export const submitKycSchema = z.object({ dateOfBirth: dateOfBirthField, panNumber: panField })

// Edit: send the field(s) to change; at least one.
export const updateKycSchema = z
  .object({ dateOfBirth: dateOfBirthField.optional(), panNumber: panField.optional() })
  .refine(v => v.dateOfBirth !== undefined || v.panNumber !== undefined, { message: 'Send dateOfBirth, panNumber or both' })


// ─── Sign in with Google / Apple ───────────────────────────────────────────

const socialDevice = {
  deviceId: z.string().max(255).optional(),
  deviceType: z.enum(['ios', 'android']).optional(),
  deviceName: deviceNameField,
  location: locationField,
  fcmToken: fcmTokenSchema.optional(),
  appVersion: z.string().trim().max(32).optional(),
}
const socialProvider = z.enum(['google', 'apple'])
const idTokenField = z.string().min(20, 'idToken is required').max(4096)
const nonceField = z.string().min(8).max(200).optional()

export const socialLoginSchema = z.object({
  provider: socialProvider,
  idToken: idTokenField,
  // The random value the app signed in with. Strongly recommended: it stops a stolen token from being replayed.
  nonce: nonceField,
  // Apple sends the name only on the very first sign-in, and not inside the token; the app passes it here.
  fullName: z.string().trim().min(2).max(100).optional(),
  ...socialDevice,
})

export const socialLinkSchema = z.object({
  linkToken: z.string().uuid('Invalid link token'),
  password: z.string().min(1, 'Password is required').max(128),
  ...socialDevice,
})

export const socialPhoneSchema = z.object({
  signupToken: z.string().uuid('Invalid signup token'),
  phone: phoneSchema,
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100).optional(),
})

export const socialVerifyOtpSchema = z.object({
  otpToken: z.string().uuid('Invalid OTP token'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  ...socialDevice,
})

export const meSocialLinkSchema = z.object({
  provider: socialProvider,
  idToken: idTokenField,
  nonce: nonceField,
})
