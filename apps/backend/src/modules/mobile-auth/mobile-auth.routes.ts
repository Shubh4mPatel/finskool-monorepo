import { Router } from 'express'
import { MobileAuthService } from './mobile-auth.service.js'
import { MobileAuthController } from './mobile-auth.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
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
 *       have completed /auth/mobile/verify-otp first. No JWT is issued for
 *       mobile at all: on success a single opaque session id is generated,
 *       stored (hashed) on this user's MobileSession row — overwriting and
 *       thereby killing any previous mobile session for this account — and
 *       set as an httpOnly `mobile_session_id` cookie. A "new device login"
 *       email is sent on every successful call, unconditionally.
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
 *               deviceId: { type: string, example: "device-uuid-from-client" }
 *               deviceType: { type: string, enum: [ios, android] }
 *     responses:
 *       200:
 *         description: Logged in. The session id is set as an httpOnly `mobile_session_id` cookie, not returned in the body.
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

/**
 * @openapi
 * /auth/mobile/forgot-password:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Request a password-reset code
 *     description: >
 *       Always responds with the same generic message, whether or not the
 *       email matches an account — no OTP is actually sent unless the
 *       account exists, is active, has a password set, and has completed
 *       phone verification (isPhoneVerified). This is intentional: it
 *       prevents using this endpoint to discover which emails are registered.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: jane@example.com }
 *     responses:
 *       200:
 *         description: Always returned, regardless of whether the email matched anything.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "If an account with this email exists and is verified, we've sent a password reset code." }
 *       422:
 *         description: Validation failed (malformed email).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/forgot-password', controller.forgotPassword)

/**
 * @openapi
 * /auth/mobile/forgot-password/verify-otp:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Verify the password-reset OTP
 *     description: >
 *       On success, returns a one-time "cypher" instead of logging the user
 *       in. That cypher — not a session or JWT — is what authorizes the
 *       follow-up POST /auth/mobile/forgot-password/reset call; it's
 *       single-use and expires on its own shortly after issue.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email, example: jane@example.com }
 *               otp: { type: string, pattern: '^\d{6}$', example: "482913" }
 *     responses:
 *       200:
 *         description: Code verified — cypher issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Code verified." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     cypher: { type: string, description: "Opaque one-time token, not a session/JWT.", example: "3f9a1c...b02e" }
 *                     cypherExpiresInSeconds: { type: integer, example: 600 }
 *       400:
 *         description: Incorrect or expired code (code OTP_INVALID) — deliberately the same response for a wrong OTP and an email with no OTP outstanding.
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
router.post('/forgot-password/verify-otp', controller.verifyResetOtp)

/**
 * @openapi
 * /auth/mobile/forgot-password/reset:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Set a new password using a verified-OTP cypher
 *     description: >
 *       No authentication/session is used or required here — the `cypher`
 *       from verify-otp is the sole proof that the OTP step was completed.
 *       It's consumed (deleted) as soon as this call is made, successfully
 *       or not, so it can never be replayed. Does NOT log the user in; call
 *       POST /auth/mobile/login afterward.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cypher, newPassword, confirmNewPassword]
 *             properties:
 *               cypher: { type: string, example: "3f9a1c...b02e" }
 *               newPassword: { type: string, format: password, minLength: 8, example: NewSecurePass456 }
 *               confirmNewPassword: { type: string, format: password, example: NewSecurePass456 }
 *     responses:
 *       200:
 *         description: Password reset.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Password reset successfully. Please log in." }
 *       400:
 *         description: Cypher missing, expired, already used, or no longer valid (code RESET_TOKEN_INVALID).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed (weak password or confirmation mismatch).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/forgot-password/reset', controller.resetPassword)

/**
 * @openapi
 * /auth/mobile/logout:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: End the current mobile session
 *     description: >
 *       Deletes this user's MobileSession row (if the presented cookie's
 *       hash still matches it — an already-superseded cookie matches
 *       nothing, so this is a silent no-op in that case) and clears the
 *       `mobile_session_id` cookie either way. Idempotent — safe to call
 *       with no cookie, an expired one, or one already logged out.
 *     responses:
 *       200:
 *         description: Always returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Logged out" }
 */
router.post('/logout', controller.logout)

/**
 * @openapi
 * /auth/mobile/select-community:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Switch the active community (mobile flow)
 *     description: >
 *       Mobile equivalent of POST /auth/select-community — but since there's
 *       no access token to re-sign, this updates the cached
 *       selectedCommunityId directly on the caller's MobileSession row.
 *       Requires an active mobile session (this route runs behind
 *       `authenticate`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [communityId]
 *             properties:
 *               communityId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Selection updated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *       401:
 *         description: Not authenticated, or no active mobile session found (code SESSION_INVALIDATED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Caller isn't subscribed to this community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/select-community', authenticate, controller.selectCommunity)

export default router
