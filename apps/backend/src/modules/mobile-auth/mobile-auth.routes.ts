import { Router } from 'express'
import { MobileAuthService } from './mobile-auth.service.js'
import { MobileAuthController } from './mobile-auth.controller.js'
import { SocialAuthService } from './social-auth.service.js'
import { SocialAuthController } from './social-auth.controller.js'
import { authenticate, requireMobileAuth } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'
import redis from '../../lib/redis.js'

const service = new MobileAuthService(prisma, redis)
const controller = new MobileAuthController(service)
const social = new SocialAuthController(new SocialAuthService(prisma, redis, service))

const router = Router()

/**
 * @openapi
 * /auth/mobile/register:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Start self-serve mobile registration
 *     description: >
 *       Open registration — no admin needs to have pre-added this phone number.
 *       Does NOT create a database row: the submitted data + a hashed password
 *       are held in Redis for 10 minutes under the `userId` returned below,
 *       and a 6-digit OTP is sent via WhatsApp to the given phone number. The
 *       account is only actually created —
 *       and only then does the phone number/email become "taken" — once
 *       /auth/mobile/verify-otp succeeds; an abandoned registration just
 *       expires with its OTP, with nothing left behind to clean up.
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
 *                 message: { type: string, example: "OTP sent to your WhatsApp. Verify it to complete registration." }
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
 *       Confirms the code sent via WhatsApp by /auth/mobile/register. This is the call
 *       that actually creates (or, for a phone pre-added by an admin, finishes
 *       claiming) the account in the database — nothing exists yet before
 *       this succeeds. Does NOT log the user in; call POST /auth/login
 *       separately afterward to get a session.
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
 *         description: >
 *           Incorrect code (OTP_INVALID); registration session not found or
 *           its 10-minute window expired, so it must be started over via
 *           /auth/mobile/register again (OTP_EXPIRED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Phone number's access was revoked by an admin since registering (code PHONE_INACTIVE).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       409:
 *         description: >
 *           Someone else already claimed this phone number/email in the last
 *           few minutes — e.g. a duplicate registration attempt that got
 *           verified first (code ALREADY_REGISTERED).
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
 *                 message: { type: string, example: "A new code has been sent to your WhatsApp." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     otpExpiresInSeconds: { type: integer, example: 600 }
 *       404:
 *         description: >
 *           Registration session not found or expired — the 10-minute window
 *           from /auth/mobile/register has passed. Register again from
 *           scratch (code REGISTRATION_EXPIRED).
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
 *       logic. No JWT is issued for mobile at all: on success a single opaque session id is generated,
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
 *               fcmToken: { type: string, description: FCM device token for push notifications }
 *               appVersion: { type: string }
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
 *                         panSubmitted: { type: boolean, description: "Whether PAN + date of birth were submitted via POST /auth/mobile/me/kyc. The PAN itself is never returned." }
 *                         dateOfBirth: { type: string, nullable: true, example: "1995-04-12" }
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
 *           (NOT_REGISTERED), or subscription expired (SUBSCRIPTION_EXPIRED).
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
 *       account exists, is active, and has a password set (i.e. has actually
 *       completed registration). This is intentional: it prevents using this
 *       endpoint to discover which emails are registered.
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
 * /auth/mobile/me:
 *   get:
 *     tags: [Mobile Auth]
 *     summary: Get the authenticated mobile user's profile
 *     description: >
 *       Mobile-only (requireMobileAuth). Returns avatar/email/phone/notification
 *       preference, plus every community the user has ever paid for (excluding the
 *       single isFree community) — one row per community, showing that community's
 *       most recent subscription's expiry date regardless of whether it's still
 *       active. A lapsed community stays in the list with a past `expiresAt`; compare
 *       client-side against today's date to show active vs. expired.
 *     responses:
 *       200:
 *         description: Profile fetched.
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
 *                         avatarUrl: { type: string, nullable: true }
 *                         email: { type: string }
 *                         phone: { type: string }
 *                         postNotificationsEnabled: { type: boolean }
 *                         panSubmitted: { type: boolean, description: "Whether PAN + date of birth were submitted via POST /auth/mobile/me/kyc. The PAN itself is never returned." }
 *                         dateOfBirth: { type: string, nullable: true, example: "1995-04-12" }
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
 *                           expiresAt: { type: string, example: "2026-03-15", description: "Latest subscription's expiry for this community, past or future." }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Authenticated via web JWT instead of a mobile session (code MOBILE_ONLY).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.get('/me', authenticate, requireMobileAuth, controller.getProfile)

/**
 * @openapi
 * /auth/mobile/me/kyc:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Submit date of birth and PAN (first time)
 *     description: >
 *       Mobile-only (requireMobileAuth). Saves the caller's date of birth and
 *       PAN. The PAN is stored encrypted and is never returned by any mobile
 *       endpoint — `GET /auth/mobile/me` only reports `panSubmitted`. A second
 *       call, even with different values, returns 409 KYC_ALREADY_SUBMITTED and
 *       changes nothing; use PUT /auth/mobile/me/kyc to edit. The PAN is trimmed and
 *       upper-cased before validation, so `abcde1234f` is accepted.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dateOfBirth, panNumber]
 *             properties:
 *               dateOfBirth: { type: string, pattern: '^\d{4}-\d{2}-\d{2}$', example: "1995-04-12", description: "A real past date, 1900-01-01 or later." }
 *               panNumber: { type: string, pattern: '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$', example: "ABCDE1234F" }
 *     responses:
 *       201:
 *         description: Details saved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     panSubmitted: { type: boolean, example: true }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Authenticated via web JWT instead of a mobile session (code MOBILE_ONLY).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       409:
 *         description: Details were already submitted and can't be changed (code KYC_ALREADY_SUBMITTED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Invalid PAN format or date of birth.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/me/kyc', authenticate, requireMobileAuth, controller.submitKyc)

/**
 * @openapi
 * /auth/mobile/me/kyc:
 *   get:
 *     tags: [Mobile Auth]
 *     summary: Has the member given date of birth and PAN? (the flag the app checks)
 *     description: >
 *       Call after login / on app start. `completed: false` means the app should show the date of birth + PAN form
 *       (POST /auth/mobile/me/kyc) and ask again on later launches until it is true. When `completed` is true the
 *       app never asks or sends them again. The full PAN is never returned, only `panMasked`.
 *     responses:
 *       200:
 *         description: "{ success, data: { completed, dateOfBirth: 'YYYY-MM-DD' | null, panMasked: 'XXXXXX234F' | null } }"
 *       401:
 *         description: Not authenticated.
 */
router.get('/me/kyc', authenticate, requireMobileAuth, controller.getKyc)

/**
 * @openapi
 * /auth/mobile/me/kyc:
 *   put:
 *     tags: [Mobile Auth]
 *     summary: Edit date of birth and/or PAN after they were submitted
 *     description: >
 *       Send `dateOfBirth`, `panNumber` or both (same formats as the first submit). Returns the new flag, like GET.
 *       Returns 409 KYC_NOT_SUBMITTED if nothing was submitted yet (use POST first).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dateOfBirth: { type: string, example: "1995-04-12" }
 *               panNumber: { type: string, example: "ABCDE1234F" }
 *     responses:
 *       200:
 *         description: Updated; body is the same as GET /auth/mobile/me/kyc.
 *       409:
 *         description: Nothing submitted yet (code KYC_NOT_SUBMITTED).
 *       422:
 *         description: Invalid PAN or date of birth, or neither field sent.
 */
router.put('/me/kyc', authenticate, requireMobileAuth, controller.updateKyc)

// ─── Sign in with Google / Apple ───────────────────────────────────────────
// Full guide: docs/mobile-social-login.md. Off until SOCIAL_LOGIN_ENABLED=true (404 SOCIAL_LOGIN_DISABLED).

/**
 * @openapi
 * /auth/mobile/social/login:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Continue with Google or Apple (step 1)
 *     description: >
 *       Send the provider's ID token. The answer is one of three, in `data.status`:
 *       `logged_in` (known login: session cookie set, body has `user` and `communities` like password login),
 *       `link_required` (an account with this verified email already exists: ask for its password, then POST /social/link),
 *       `phone_required` (new person, or a member an admin added: ask for the phone, then POST /social/phone).
 *       Nothing is created or linked from the token alone.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, idToken]
 *             properties:
 *               provider: { type: string, enum: [google, apple] }
 *               idToken: { type: string }
 *               nonce: { type: string, description: "The random value the sign-in was started with (recommended)." }
 *               fullName: { type: string, description: "Apple only: the name Apple gave the app on the first sign-in." }
 *               deviceId: { type: string }
 *               deviceType: { type: string, enum: [ios, android] }
 *               fcmToken: { type: string }
 *               appVersion: { type: string }
 *     responses:
 *       200: { description: "{ success, data: { status, ... } }" }
 *       400: { description: Email not verified (SOCIAL_EMAIL_UNVERIFIED). }
 *       401: { description: Token invalid (SOCIAL_TOKEN_INVALID) or the account is deactivated. }
 *       404: { description: Feature switched off (SOCIAL_LOGIN_DISABLED). }
 *       429: { description: Too many attempts. }
 */
router.post('/social/login', social.login)

/**
 * @openapi
 * /auth/mobile/social/link:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Confirm the password of the existing account to link Google or Apple (step 2 after link_required)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [linkToken, password]
 *             properties:
 *               linkToken: { type: string, format: uuid }
 *               password: { type: string }
 *               deviceId: { type: string }
 *               deviceType: { type: string, enum: [ios, android] }
 *               fcmToken: { type: string }
 *               appVersion: { type: string }
 *     responses:
 *       200: { description: "Linked and logged in: same body as POST /social/login with status logged_in." }
 *       400: { description: Step expired (SOCIAL_STEP_EXPIRED). }
 *       401: { description: Wrong password (SOCIAL_LINK_PASSWORD_INVALID). }
 *       429: { description: Five wrong passwords (SOCIAL_LINK_LOCKED) or rate limited. }
 */
router.post('/social/link', social.link)

/**
 * @openapi
 * /auth/mobile/social/phone:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Give the phone number and get the WhatsApp OTP (step 2 after phone_required)
 *     description: >
 *       If an admin already added this phone, that same account (with its plans) is the one claimed and linked
 *       after the OTP, not a second account. A phone that already belongs to a registered account answers 409
 *       ALREADY_REGISTERED. Use POST /auth/mobile/resend-otp with `userId` = `otpToken` to resend the code.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signupToken, phone]
 *             properties:
 *               signupToken: { type: string, format: uuid }
 *               phone: { type: string }
 *               fullName: { type: string, description: "Needed only when the provider gave no name." }
 *     responses:
 *       200: { description: "{ success, data: { otpToken, phone, otpExpiresInSeconds } }" }
 *       400: { description: Step expired (SOCIAL_STEP_EXPIRED) or no name (NAME_REQUIRED). }
 *       403: { description: Access revoked (PHONE_INACTIVE). }
 *       409: { description: ALREADY_REGISTERED or EMAIL_TAKEN. }
 *       429: { description: Too many attempts. }
 */
router.post('/social/phone', social.phone)

/**
 * @openapi
 * /auth/mobile/social/verify-otp:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: "Confirm the OTP: account created or claimed, Google linked, logged in (final step)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otpToken, otp]
 *             properties:
 *               otpToken: { type: string, format: uuid }
 *               otp: { type: string, pattern: '^\d{6}$' }
 *               deviceId: { type: string }
 *               deviceType: { type: string, enum: [ios, android] }
 *               fcmToken: { type: string }
 *               appVersion: { type: string }
 *     responses:
 *       200: { description: "Same body as POST /social/login with status logged_in; the session cookie is set." }
 *       400: { description: OTP_EXPIRED or OTP_INVALID. }
 *       429: { description: OTP_LOCKED after 5 wrong codes. }
 */
router.post('/social/verify-otp', social.verifyOtp)

/**
 * @openapi
 * /auth/mobile/me/social/link:
 *   post:
 *     tags: [Mobile Auth]
 *     summary: Add Google or Apple to the logged-in account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, idToken]
 *             properties:
 *               provider: { type: string, enum: [google, apple] }
 *               idToken: { type: string }
 *               nonce: { type: string }
 *     responses:
 *       200: { description: "{ success, data: { linkedProviders: ['google'] } }" }
 *       409: { description: Already linked to another member (SOCIAL_ALREADY_LINKED) or another account of this provider is linked (SOCIAL_PROVIDER_ALREADY_LINKED). }
 */
router.post('/me/social/link', authenticate, requireMobileAuth, social.linkToAccount)

export default router
