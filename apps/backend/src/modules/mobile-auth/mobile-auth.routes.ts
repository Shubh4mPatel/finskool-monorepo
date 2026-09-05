import { Router } from 'express'
import { MobileAuthService } from './mobile-auth.service.js'
import { MobileAuthController } from './mobile-auth.controller.js'
import prisma from '../../lib/prisma.js'
import redis from '../../lib/redis.js'

const service = new MobileAuthService(prisma, redis)
const controller = new MobileAuthController(service)

const router = Router()

/**
 * @openapi
 * /auth/mobile/register:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Start self-serve mobile registration
 *     description: >
 *       Open registration — no admin needs to have pre-added this phone number.
 *       Creates the account immediately but leaves it unverified; sends a 6-digit
 *       OTP to the given email (a stand-in for WhatsApp delivery, not yet wired
 *       up). Registration only completes once /auth/mobile/verify-otp succeeds.
 *       No auth cookies are set and no `communities` are returned by this call.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, phone, email, password, confirmPassword]
 *             properties:
 *               fullName: { type: string, minLength: 2, maxLength: 100, example: Jane Doe }
 *               phone: { type: string, example: "+919876543210" }
 *               email: { type: string, format: email, example: jane@example.com }
 *               password: { type: string, format: password, minLength: 8, example: SecurePass123 }
 *               confirmPassword: { type: string, format: password, example: SecurePass123 }
 *     responses:
 *       201:
 *         description: Account created, OTP sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "OTP sent to your email. Verify it to complete registration." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId: { type: string, format: uuid }
 *                     phone: { type: string }
 *                     email: { type: string }
 *                     otpExpiresInSeconds: { type: integer, example: 600 }
 *       409:
 *         description: Phone already fully registered, or email already in use (code ALREADY_REGISTERED | EMAIL_TAKEN).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Phone number's access has been revoked by an admin (code PHONE_INACTIVE).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/register', controller.register)

/**
 * @openapi
 * /auth/mobile/verify-otp:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Verify the OTP and complete registration
 *     description: >
 *       Confirms the code emailed by /auth/mobile/register. On success the
 *       account is marked verified — this call does NOT log the user in;
 *       call POST /auth/login separately afterward to get a session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, otp]
 *             properties:
 *               userId: { type: string, format: uuid }
 *               otp: { type: string, pattern: '^\d{6}$', example: "482913" }
 *     responses:
 *       200:
 *         description: Phone number verified.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Phone number verified. You can now log in." }
 *       400:
 *         description: Incorrect or expired code (code OTP_INVALID | OTP_EXPIRED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       409:
 *         description: Account already verified (code ALREADY_VERIFIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       429:
 *         description: Too many incorrect attempts — request a new code (code OTP_LOCKED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/verify-otp', controller.verifyOtp)

/**
 * @openapi
 * /auth/mobile/resend-otp:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Resend the OTP
 *     description: Rate-limited to one send per 60 seconds per account.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: A new code was sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "A new code has been sent to your email." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     otpExpiresInSeconds: { type: integer, example: 600 }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       409:
 *         description: Account already verified (code ALREADY_VERIFIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       429:
 *         description: Cooldown still active (code OTP_COOLDOWN).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/resend-otp', controller.resendOtp)

/**
 * @openapi
 * /auth/mobile/login:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Log in (mobile flow)
 *     description: >
 *       Independent from POST /auth/login — same lookup/password/subscription
 *       logic, plus one extra check specific to this flow: the account must
 *       have completed /auth/mobile/verify-otp first. On success, sets the
 *       same httpOnly access_token/refresh_token cookies as the web login.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: jane@example.com }
 *               password: { type: string, format: password, example: SecurePass123 }
 *     responses:
 *       200:
 *         description: Logged in. Tokens are set as httpOnly cookies, not returned in the body.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         phone: { type: string }
 *                         email: { type: string }
 *                         role: { type: string, enum: [admin, member] }
 *                         isSuperAdmin: { type: boolean }
 *                         avatarUrl: { type: string, nullable: true }
 *                         postNotificationsEnabled: { type: boolean }
 *                     communities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           slug: { type: string }
 *                           description: { type: string, nullable: true }
 *                           tags: { type: array, items: { type: string } }
 *                           coverImageUrl: { type: string, nullable: true }
 *                           badgeUrl: { type: string, nullable: true }
 *                           memberCount: { type: integer }
 *       401:
 *         description: >
 *           Invalid credentials, deactivated account, never registered
 *           (NOT_REGISTERED), phone not yet verified (PHONE_NOT_VERIFIED —
 *           the check unique to this endpoint), or subscription expired
 *           (SUBSCRIPTION_EXPIRED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/login', controller.login)

export default router
