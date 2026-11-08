import { lockPushToken, withTokenRetry } from '../../lib/push-token.js'
import { randomInt, randomBytes, randomUUID, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { UAParser } from 'ua-parser-js'
import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import {
  pendingRegistrationKey,
  pendingRegistrationCooldownKey,
  passwordResetOtpKey,
  passwordResetOtpCooldownKey,
  passwordResetCypherKey,
} from '../../lib/redis.js'
import { hashSessionId } from '../../lib/mobile-session.js'
import {
  notificationsQueue,
  OTP_WHATSAPP_JOB,
  PASSWORD_RESET_OTP_EMAIL_JOB,
  MOBILE_NEW_LOGIN_EMAIL_JOB,
} from '../../lib/queue.js'
import { logger } from '../../shared/logger.js'
import { getAccessibleCommunityIds, getAdminIdsWithMemberAccess } from '../../lib/community-access.js'
import { notifyAdmins } from '../../lib/admin-notify.js'
import { routingData, RoutingModule } from '../../lib/notification-routing.js'
import { NotificationType } from '../notifications/notifications.dto.js'
import { ensureFreeSubscription } from '../../lib/free-community.js'
import { decryptPan, encryptPan, isPanKeyConfigured } from '../../lib/pan-crypto.js'
import { latestInvoiceByCommunity } from '../../lib/plan-receipt.js'
import type { SocialProvider } from '../../lib/social-token.js'
import { notExpired } from '../../lib/subscription-expiry.js'
import {
  ConflictError,
  AppError,
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  TooManyRequestsError,
} from '../../shared/errors/index.js'
import type {
  MobileRegisterDTO,
  MobileRegisterResponseDTO,
  MobileLoginDTO,
  MobileLoginResultInternal,
  VerifyResetOtpResponseDTO,
  PublicUserDTO,
  CommunityInfoDTO,
  PaidCommunityDTO,
  MobileProfileDTO,
  SubmitKycDTO,
  KycStatusDTO,
  UpdateKycDTO,
} from './mobile-auth.dto.js'

const BCRYPT_ROUNDS = 12
const OTP_TTL_SECONDS = 10 * 60 // 10 minutes
const OTP_RESEND_COOLDOWN_SECONDS = 60
const MAX_OTP_ATTEMPTS = 5
// How long a verified-OTP "cypher" (see verifyResetOtp/resetPassword below)
// stays redeemable — long enough to type a new password, short enough that a
// leaked cypher isn't useful for long.
const RESET_CYPHER_TTL_SECONDS = 10 * 60

interface OtpRecord {
  hash: string
  attempts: number
}

// Everything register() would otherwise have written to Postgres immediately,
// held in Redis instead until verifyOtp() confirms the code. No User row
// exists — and `passwordHash` is set nowhere in the database — until that
// happens, which is the whole point: see the module-level comment on
// register() below for what this fixes.
interface PendingRegistration {
  fullName: string
  phone: string
  email: string
  passwordHash: string
  // Set when this phone was pre-added by an admin (a User/ApprovedPhone row
  // already exists, just with no password yet) — verifyOtp() updates that
  // row instead of creating a new one. Null for a genuinely new phone.
  existingUserId: string | null
  // Set only for "continue with Google / Apple": the verified identity to link once the phone's OTP is confirmed,
  // and the signup token to burn at that point. Absent for ordinary password registration.
  social?: { provider: SocialProvider; sub: string; email: string | null; signupToken: string }
  otpHash: string
  otpAttempts: number
}

/** What a pending registration holds before the OTP is generated. */
export type PendingRegistrationInput = Omit<PendingRegistration, 'otpHash' | 'otpAttempts'>

// Mirrors auth.service.ts's own DbUser — kept separate on purpose, see login() below.
type DbUser = {
  id: string
  name: string
  phone: string
  email: string | null
  passwordHash: string | null
  role: string
  isSuperAdmin: boolean
  avatarUrl: string | null
  postNotificationsEnabled: boolean
}

function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex')
}

function generateOtp(): string {
  // 6-digit numeric code, zero-padded (randomInt is cryptographically secure,
  // unlike Math.random) — matches the digit-only OTP shape the mobile client expects.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

// "Chrome on Windows" / "Safari on Apple iPhone" style label for the
// new-device-login email. Best-effort — an unparseable or missing
// User-Agent just falls back to a generic label rather than failing login.
function parseDeviceName(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device'
  const { browser, os, device } = new UAParser(userAgent).getResult()
  const osLabel = device.vendor && device.model ? `${device.vendor} ${device.model}` : os.name
  if (browser.name && osLabel) return `${browser.name} on ${osLabel}`
  return browser.name || osLabel || 'Unknown device'
}

export class MobileAuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  /**
   * Open, self-serve registration — unlike the web flow (auth.service.ts#register),
   * this does NOT require an admin to have pre-added the phone number first.
   *
   * Deliberately does NOT touch Postgres. Everything submitted here (plus the
   * hashed password and the OTP itself) is held in Redis under a fresh opaque
   * token, TTL'd to the OTP's own lifetime — verifyOtp() is the only place
   * that ever creates/updates a User row, and only once the code is
   * confirmed. This used to write the User row (with the real password hash)
   * immediately, gated behind a separate `isPhoneVerified` flag flipped at
   * verify time — which meant an abandoned OTP left a permanent,
   * unrecoverable half-account behind (looked "already registered" to
   * register(), but couldn't log in or use forgot-password either). That
   * flag is gone now: `passwordHash` itself is only ever written here at
   * verify time, so its presence already means "verified," for every row.
   * Nothing here writes to Postgres, so nothing here can get stuck: an
   * abandoned attempt just expires along with its OTP.
   *
   * The response shape is unchanged on purpose — `userId` is still a string
   * the client echoes back to verify-otp/resend-otp, it's just an opaque
   * token now rather than a real Users.id.
   */
  async register(data: MobileRegisterDTO): Promise<MobileRegisterResponseDTO> {
    logger.info({ phone: data.phone }, 'mobileAuth.register: attempt')

    const existing = await this.db.user.findUnique({ where: { phone: data.phone } })
    let existingUserId: string | null = null

    if (existing) {
      // Phone already fully registered (web or a previous completed mobile flow)
      if (existing.passwordHash) {
        throw new ConflictError(
          'This phone number is already registered. Please log in.',
          'ALREADY_REGISTERED',
        )
      }
      if (existing.status !== 'active') {
        throw new ForbiddenError(
          'Your access has been revoked. Please contact your admin.',
          'PHONE_INACTIVE',
        )
      }
      if (data.email !== existing.email) {
        const emailTaken = await this.db.user.findFirst({
          where: { email: data.email, id: { not: existing.id } },
        })
        if (emailTaken) throw new ConflictError('This email address is already registered', 'EMAIL_TAKEN')
      }
      existingUserId = existing.id
    } else {
      // Brand new phone — nobody added it; check email isn't taken by anyone
      const emailTaken = await this.db.user.findFirst({ where: { email: data.email } })
      if (emailTaken) throw new ConflictError('This email address is already registered', 'EMAIL_TAKEN')
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS)
    // No dedup against a possibly-already-pending registration for this same
    // phone — a retried/duplicate submission just gets its own independent
    // token+OTP. Harmless: whichever one is verified first wins, the DB
    // re-check inside finalizeRegistration() rejects the second, and any
    // never-verified leftover just expires with its own TTL. See the
    // conversation history in the mobile-auth OTP-registration fix for why
    // this is safe without a "one pending registration per phone" lock.
    const token = randomUUID()
    await this.storePendingRegistration(token, {
      fullName: data.fullName,
      phone: data.phone,
      email: data.email,
      passwordHash,
      existingUserId,
    })

    logger.info({ token }, 'mobileAuth.register: OTP sent, registration pending in redis')
    return {
      userId: token,
      phone: data.phone,
      email: data.email,
      otpExpiresInSeconds: OTP_TTL_SECONDS,
    }
  }

  /**
   * Credential checks (lookup, active/passwordHash/password, subscription)
   * are a deliberate, self-contained duplicate of AuthService.login() — see
   * that method's own comment for why. Session issuance below is NOT a
   * duplicate of anything web does, though: mobile has no JWT at all. A
   * single opaque, high-entropy session id is generated here, its hash
   * upserted into MobileSession (one row per user — this
   * upsert is what atomically kills any prior mobile session for this user
   * and installs this one), and the raw value is handed back for the
   * controller to set as an httpOnly cookie. It's never returned again.
   */
  async login(
    data: MobileLoginDTO,
    meta: { userAgent: string | undefined; ip: string | undefined },
  ): Promise<MobileLoginResultInternal> {
    logger.info({ email: data.email }, 'mobileAuth.login: attempt')

    const user = await this.db.user.findUnique({ where: { email: data.email } })
    if (!user || user.deletedAt) {
      throw new UnauthorizedError('Invalid email or password')
    }
    if (user.status !== 'active') {
      throw new UnauthorizedError('Your account has been deactivated. Please contact your admin.')
    }
    if (!user.passwordHash) {
      throw new UnauthorizedError(
        'You have not registered yet. Please sign up first to set your password.',
        'NOT_REGISTERED',
      )
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash)
    if (!valid) {
      logger.warn({ email: data.email }, 'mobileAuth.login: invalid password')
      throw new UnauthorizedError('Invalid email or password')
    }

    return this.completeLogin(user, data, meta)
  }

  /**
   * Everything after "this person has proven who they are": free community, subscription gate, session row,
   * push token, new-login email. Shared by password login and the Google / Apple paths, so a social login is
   * exactly as strict (and as lenient) as a password one.
   */
  async completeLogin(
    user: DbUser,
    data: {
      deviceId?: string | undefined
      deviceType?: 'ios' | 'android' | undefined
      deviceName?: string | undefined
      location?: string | undefined
      fcmToken?: string | undefined
      appVersion?: string | undefined
    },
    meta: { userAgent: string | undefined; ip: string | undefined },
  ): Promise<MobileLoginResultInternal> {
    // Accounts created before the free community existed (or added/imported by
    // an admin) have no free subscription row yet — grant it here so every
    // member has it, and so a member whose paid plans have all lapsed can still
    // log in to the free tier instead of being locked out.
    if (user.role !== 'admin') await ensureFreeSubscription(this.db, user.id)

    if (user.role !== 'admin' && !(await this.hasActiveSubscription(user.id))) {
      throw new UnauthorizedError(
        'Your subscription has expired. Please contact your admin to renew.',
        'SUBSCRIPTION_EXPIRED',
      )
    }

    const communities = await this.fetchUserCommunities(user.id)
    const communityIds = communities.map(c => c.id)
    const selectedCommunityId = communityIds.length === 1 ? (communityIds[0] ?? null) : null
    const accessibleCommunityIds = await this.computeAccessibleCommunityIds(user.id, user.role)

    const rawSessionId = randomBytes(32).toString('hex')
    const sessionIdHash = hashSessionId(rawSessionId)
    // What the app says the phone is, else what the request's user agent says. A blank string counts as not sent.
    const deviceName = data.deviceName?.trim() || parseDeviceName(meta.userAgent)
    const location = data.location?.trim() || null

    const sessionData = {
      sessionIdHash,
      deviceId: data.deviceId ?? null,
      deviceType: data.deviceType ?? null,
      deviceName,
      location,
      ip: meta.ip ?? null,
      communityIds,
      selectedCommunityId,
      // Prisma's typed Json input rejects a bare `null` (ambiguous with
      // "field omitted") — Prisma.JsonNull is the explicit "store JSON null"
      // sentinel, used here for the super-admin/"unrestricted" case.
      accessibleCommunityIds: accessibleCommunityIds ?? Prisma.JsonNull,
      // A new login replaces the session, so the previous phone's push token is dropped
      // (null) unless this login brings its own.
      fcmToken: data.fcmToken ?? null,
      fcmTokenUpdatedAt: data.fcmToken ? new Date() : null,
      appVersion: data.appVersion ?? null,
    }
    await withTokenRetry(() =>
      this.db.$transaction(async tx => {
        // A phone belongs to one logged-in member: if another account still holds this token, take it over.
        if (data.fcmToken) await lockPushToken(tx, data.fcmToken)
        if (data.fcmToken) await tx.mobileSession.updateMany({ where: { fcmToken: data.fcmToken, NOT: { userId: user.id } }, data: { fcmToken: null, fcmTokenUpdatedAt: null } })
        await tx.mobileSession.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...sessionData },
          update: sessionData,
        })
      }),
    )

    try {
      await notificationsQueue.add(
        MOBILE_NEW_LOGIN_EMAIL_JOB,
        { toEmail: user.email!, name: user.name, deviceName, ...(location ? { location } : {}), loginAt: new Date().toISOString() },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      // Swallowed — a failed notification must never block or fail the login itself.
      logger.error({ err, userId: user.id }, 'mobileAuth.login: failed to enqueue new-login email job')
    }

    logger.info({ userId: user.id }, 'mobileAuth.login: success')
    return { sessionId: rawSessionId, user: this.toPublicUser(user), communities }
  }

  /**
   * Idempotent by construction: sessionIdHash is unique, so if this session
   * was already superseded by a newer login (or already logged out), the
   * delete simply matches nothing — deleteMany (not delete) so that's a
   * silent no-op rather than a thrown "record not found".
   */
  async logout(rawSessionId: string): Promise<void> {
    await this.db.mobileSession.deleteMany({ where: { sessionIdHash: hashSessionId(rawSessionId) } })
  }

  /**
   * `token` is whatever register() returned as `userId` — a Redis-only
   * reference, not a Users.id (see register()'s own doc comment). Confirming
   * the code here is what actually creates/updates the User row; nothing in
   * Postgres exists for this registration before this call succeeds.
   */
  async verifyOtp(token: string, otp: string): Promise<void> {
    // Password registration only: a "continue with Google / Apple" token has its own endpoint, which also logs the member in.
    const { userId, pending } = await this.confirmOtp(token, otp, false)
    logger.info({ userId, phone: pending.phone }, 'mobileAuth.verifyOtp: success, account created')
    await this.notifyAdminsOfRegistration(userId, pending)
  }

  /**
   * Checks the OTP of a pending registration and, if right, creates (or claims) the account. `social` says which
   * kind of pending registration is expected; the other kind is answered like an expired code, so a token from one
   * flow can never be redeemed through the other.
   */
  async confirmOtp(token: string, otp: string, social: boolean): Promise<{ userId: string; pending: PendingRegistration }> {
    const raw = await this.redis.get(pendingRegistrationKey(token))
    if (!raw) {
      throw new BadRequestError(
        'This code has expired. Please request a new one.',
        'OTP_EXPIRED',
      )
    }

    const pending = JSON.parse(raw) as PendingRegistration
    if (Boolean(pending.social) !== social) {
      throw new BadRequestError('This code has expired. Please request a new one.', 'OTP_EXPIRED')
    }
    if (pending.otpAttempts >= MAX_OTP_ATTEMPTS) {
      await this.redis.del(pendingRegistrationKey(token))
      throw new TooManyRequestsError(
        'Too many incorrect attempts. Please request a new code.',
        'OTP_LOCKED',
      )
    }

    if (hashOtp(otp) !== pending.otpHash) {
      const ttl = await this.redis.ttl(pendingRegistrationKey(token))
      const updated: PendingRegistration = { ...pending, otpAttempts: pending.otpAttempts + 1 }
      await this.redis.set(pendingRegistrationKey(token), JSON.stringify(updated), 'EX', ttl > 0 ? ttl : OTP_TTL_SECONDS)
      throw new BadRequestError('Incorrect code. Please try again.', 'OTP_INVALID')
    }

    // Code confirmed — consume the pending record now, regardless of what
    // finalizeRegistration does below. A token that loses the race in there
    // (someone else claimed this phone/email in the last few minutes) can
    // never succeed on retry either, so there's nothing to gain by keeping
    // it alive for its remaining TTL.
    await this.redis.del(pendingRegistrationKey(token))

    const userId = await this.finalizeRegistration(pending)
    return { userId, pending }
  }

  /** Every admin who can open the new member's profile sees them in their inbox; tapping it opens that profile. */
  async notifyAdminsOfRegistration(userId: string, pending: Pick<PendingRegistration, 'fullName' | 'phone'>): Promise<void> {
    await notifyAdmins({
      db: this.db,
      adminIds: await getAdminIdsWithMemberAccess(this.db, userId),
      type: NotificationType.NewMemberRegistered,
      sourceId: userId,
      communityId: null,
      title: `${pending.fullName} has registered`,
      message: `New member joined with ${pending.phone}.`,
      data: routingData({ module: RoutingModule.Member, id: userId, communityId: null }),
    })
  }

  /**
   * The only place a mobile-registered User row is ever created or given its
   * password. Re-validates against Postgres fresh rather than trusting
   * anything cached in `pending` — several minutes may have passed since
   * register() ran (an admin could have revoked the phone, someone else
   * could have grabbed the email).
   */
  async finalizeRegistration(pending: PendingRegistration): Promise<string> {
    try {
      return await this.db.$transaction(async tx => {
        if (pending.existingUserId) {
          // Freshness check, not a race guard (that's the updateMany below) —
          // an admin could have revoked this phone sometime in the last few
          // minutes since register() ran.
          const current = await tx.user.findUnique({
            where: { id: pending.existingUserId },
            select: { status: true },
          })
          if (!current) {
            throw new NotFoundError('This phone number is no longer available. Please register again.')
          }
          if (current.status !== 'active') {
            throw new ForbiddenError('Your access has been revoked. Please contact your admin.', 'PHONE_INACTIVE')
          }

          // Conditional update, not read-then-write: guards against two
          // verifyOtp() calls for the same pre-added phone racing each other
          // (e.g. a duplicate registration attempt per §Q2) by making
          // "is this still unclaimed" and "claim it" one atomic operation
          // instead of two steps with a gap a second request could land in.
          const result = await tx.user.updateMany({
            where: { id: pending.existingUserId, passwordHash: null },
            data: { name: pending.fullName, email: pending.email, passwordHash: pending.passwordHash },
          })
          if (result.count === 0) {
            throw new ConflictError('This phone number is already registered. Please log in.', 'ALREADY_REGISTERED')
          }
          await tx.approvedPhone.update({
            where: { phone: pending.phone },
            data: { name: pending.fullName, email: pending.email, status: 'registered' },
          })
          // Pre-added by an admin with a paid plan, but still needs the free
          // community like every other account.
          await ensureFreeSubscription(tx, pending.existingUserId)
          // "Continue with Google / Apple": the admin-added account is the one that gets linked, in this same transaction.
          if (pending.social) await this.linkIdentity(tx, pending.existingUserId, pending.social)
          return pending.existingUserId
        }

        // Brand new phone — nobody added it, so this is a User row with no
        // matching ApprovedPhone, by design: ApprovedPhone is the admin
        // module's own membership roster/addressing scheme. admin.service.ts's
        // member-management functions are now userId-primary and work for
        // this account too (list/search/suspend/reset-password/updateMember
        // all find it directly) — the only remaining consequence of having no
        // ApprovedPhone is that admin.updateMember's `source` field reads
        // 'self' for them until an admin explicitly grants a community (which
        // lazily creates one at that point). Postgres's unique constraint on
        // `phone` (caught as P2002 below) is what protects against two
        // concurrent registrations for the same never-before-seen number.
        const created = await tx.user.create({
          data: {
            phone: pending.phone,
            name: pending.fullName,
            email: pending.email,
            passwordHash: pending.passwordHash,
          },
        })

        // Every account gets the free community at signup — the mobile feed
        // requires an active subscription even for it (see
        // PostsService#resolveMobileFeedCommunity), and it keeps the account
        // from being locked out of login()'s subscription gate before an admin
        // has done anything.
        await ensureFreeSubscription(tx, created.id)
        if (pending.social) await this.linkIdentity(tx, created.id, pending.social)

        return created.id
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('This phone number or email was just registered. Please log in.', 'ALREADY_REGISTERED')
      }
      throw err
    }
  }

  async resendOtp(token: string): Promise<{ otpExpiresInSeconds: number }> {
    const raw = await this.redis.get(pendingRegistrationKey(token))
    if (!raw) {
      throw new NotFoundError(
        'This registration session has expired or was not found. Please register again.',
        'REGISTRATION_EXPIRED',
      )
    }
    const pending = JSON.parse(raw) as PendingRegistration

    const cooldownActive = await this.redis.get(pendingRegistrationCooldownKey(token))
    if (cooldownActive) {
      const ttl = await this.redis.ttl(pendingRegistrationCooldownKey(token))
      throw new TooManyRequestsError(
        `Please wait ${Math.max(ttl, 1)}s before requesting another code.`,
        'OTP_COOLDOWN',
      )
    }

    await this.storePendingRegistration(token, {
      fullName: pending.fullName,
      phone: pending.phone,
      email: pending.email,
      passwordHash: pending.passwordHash,
      existingUserId: pending.existingUserId,
      ...(pending.social ? { social: pending.social } : {}),
    })
    logger.info({ token }, 'mobileAuth.resendOtp: OTP resent')
    return { otpExpiresInSeconds: OTP_TTL_SECONDS }
  }

  /**
   * Always resolves silently, whether or not `email` matches an account —
   * the endpoint's response is identical either way, by design, so this
   * never gives an attacker a way to test which emails are registered. Only
   * an active account that has actually completed registration
   * (`passwordHash` set — which, since the register/verify-otp rework, is
   * only ever true once verification succeeded) is eligible for a reset code.
   */
  async forgotPassword(email: string): Promise<void> {
    logger.info({ email }, 'mobileAuth.forgotPassword: attempt')

    const user = await this.db.user.findUnique({ where: { email } })
    const eligible = !!user && !user.deletedAt && user.status === 'active' && !!user.passwordHash
    if (!eligible) {
      logger.info({ email }, 'mobileAuth.forgotPassword: no-op (no matching/eligible account)')
      return
    }

    // Also silent on cooldown — surfacing a 429 here would itself leak that
    // a reset was recently requested for this email.
    const cooldownActive = await this.redis.get(passwordResetOtpCooldownKey(email))
    if (cooldownActive) {
      logger.info({ email }, 'mobileAuth.forgotPassword: no-op (cooldown active)')
      return
    }

    const otp = generateOtp()
    // TEMP DEBUG (remove once email delivery is confirmed working): logs the raw OTP so it
    // can be read straight from the logs without depending on the email actually arriving.
    // Do not leave this in long-term — anyone with log access can complete a password reset.
    logger.warn({ email, otp }, 'mobileAuth.forgotPassword: DEBUG OTP VALUE')
    const record: OtpRecord = { hash: hashOtp(otp), attempts: 0 }
    await this.redis.set(passwordResetOtpKey(email), JSON.stringify(record), 'EX', OTP_TTL_SECONDS)
    await this.redis.set(passwordResetOtpCooldownKey(email), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS)

    try {
      await notificationsQueue.add(
        PASSWORD_RESET_OTP_EMAIL_JOB,
        { toEmail: user.email!, name: user.name, otp, expiryMinutes: OTP_TTL_SECONDS / 60 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      // Swallowed (unlike register's sendOtp) — the controller returns the
      // same generic message regardless, so there's nothing useful to
      // surface to the caller; logged here so ops still has visibility.
      logger.error({ err, email }, 'mobileAuth.forgotPassword: failed to enqueue reset OTP email job')
    }
  }

  /**
   * Confirms the code from forgotPassword() and, on success, issues a
   * short-lived opaque "cypher" instead of logging the user in — the whole
   * point being that resetPassword() below can trust it without needing any
   * auth/session machinery. Deliberately reuses the exact same OTP_INVALID
   * error+message for "no such OTP" and "wrong code" so this step can't be
   * used to distinguish a mistyped email from a mistyped OTP either.
   */
  async verifyResetOtp(email: string, otp: string): Promise<VerifyResetOtpResponseDTO> {
    const raw = await this.redis.get(passwordResetOtpKey(email))
    if (!raw) {
      throw new BadRequestError('Invalid or expired code. Please request a new one.', 'OTP_INVALID')
    }

    const record = JSON.parse(raw) as OtpRecord
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await this.redis.del(passwordResetOtpKey(email))
      throw new TooManyRequestsError('Too many incorrect attempts. Please request a new code.', 'OTP_LOCKED')
    }

    if (hashOtp(otp) !== record.hash) {
      const ttl = await this.redis.ttl(passwordResetOtpKey(email))
      const updated: OtpRecord = { ...record, attempts: record.attempts + 1 }
      await this.redis.set(passwordResetOtpKey(email), JSON.stringify(updated), 'EX', ttl > 0 ? ttl : OTP_TTL_SECONDS)
      throw new BadRequestError('Invalid or expired code. Please request a new one.', 'OTP_INVALID')
    }

    await this.redis.del(passwordResetOtpKey(email))

    // forgotPassword() only ever creates this OTP for an eligible account,
    // so this should always resolve — defensive re-check only, in case the
    // account changed state (e.g. got suspended) in between the two calls.
    const user = await this.db.user.findUnique({ where: { email } })
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new BadRequestError('Invalid or expired code. Please request a new one.', 'OTP_INVALID')
    }

    const cypher = randomBytes(32).toString('hex')
    await this.redis.set(passwordResetCypherKey(hashToken(cypher)), user.id, 'EX', RESET_CYPHER_TTL_SECONDS)

    logger.info({ userId: user.id }, 'mobileAuth.verifyResetOtp: success, cypher issued')
    return { cypher, cypherExpiresInSeconds: RESET_CYPHER_TTL_SECONDS }
  }

  /**
   * The only thing that authorizes this call is the cypher itself (a hash of
   * it is the Redis lookup key) — no login/session is involved, per design.
   * Single-use: the cypher is deleted the moment it's redeemed, successfully
   * or not, so it can't be replayed.
   */
  async resetPassword(cypher: string, newPassword: string): Promise<void> {
    const cypherHash = hashToken(cypher)
    const userId = await this.redis.get(passwordResetCypherKey(cypherHash))
    if (!userId) {
      throw new BadRequestError('This reset session has expired. Please start again.', 'RESET_TOKEN_INVALID')
    }
    await this.redis.del(passwordResetCypherKey(cypherHash))

    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new BadRequestError('This reset session is no longer valid.', 'RESET_TOKEN_INVALID')
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash } })

    logger.info({ userId: user.id }, 'mobileAuth.resetPassword: success')
  }

  /**
   * GET /auth/mobile/me. Unlike login()'s communities (current access only,
   * via fetchUserCommunities below), this is a purchase-history view: every
   * community ever paid for, including ones that have since lapsed.
   */
  async getProfile(userId: string): Promise<MobileProfileDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')

    const { avatarUrl, email, phone, postNotificationsEnabled } = this.toPublicUser(user)
    const communities = await this.fetchPaidCommunities(userId)
    return {
      user: {
        avatarUrl,
        email,
        phone,
        postNotificationsEnabled,
        panSubmitted: user.panEncrypted !== null,
        dateOfBirth: user.dateOfBirth?.toISOString().split('T')[0] ?? null,
        linkedProviders: (await this.db.authIdentity.findMany({ where: { userId }, select: { provider: true } })).map(i => i.provider),
      },
      communities,
    }
  }

  /**
   * Saves date of birth + PAN (encrypted) exactly once. The conditional
   * update — not a read-then-write — is what locks it: `panEncrypted: null` in
   * the where clause means two concurrent submits can't both succeed. Never
   * log the PAN or DOB here.
   */
  async submitKyc(userId: string, data: SubmitKycDTO): Promise<void> {
    this.assertKycAvailable()
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { deletedAt: true } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')

    const updated = await this.db.user.updateMany({
      where: { id: userId, panEncrypted: null },
      data: {
        dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00.000Z`),
        panEncrypted: encryptPan(data.panNumber),
        kycSubmittedAt: new Date(),
      },
    })
    if (updated.count === 0) {
      throw new ConflictError('Your details were already submitted. Use the edit option to change them.', 'KYC_ALREADY_SUBMITTED')
    }
    logger.info({ userId }, 'mobileAuth.submitKyc: success')
  }

  /**
   * Saving a PAN needs the server's PAN_ENCRYPTION_KEY. When it is missing (or still the placeholder from .env.example)
   * answer with a clear 503 the app can show, and say what is wrong in the log, instead of an anonymous 500.
   */
  private assertKycAvailable(): void {
    if (isPanKeyConfigured()) return
    logger.error('kyc: PAN_ENCRYPTION_KEY is missing or is not 64 hex characters, so date of birth and PAN cannot be saved. Set it in the server .env (openssl rand -hex 32) and restart the backend.')
    throw new AppError(503, 'Saving your details is not available right now. Please try again later.', 'KYC_UNAVAILABLE')
  }

  /** The flag the app checks to decide whether to ask for date of birth and PAN. Never returns the full PAN. */
  async getKycStatus(userId: string): Promise<KycStatusDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { deletedAt: true, dateOfBirth: true, panEncrypted: true } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')
    const dateOfBirth = user.dateOfBirth?.toISOString().split('T')[0] ?? null
    let panMasked: string | null = null
    if (user.panEncrypted) {
      try {
        panMasked = `XXXXXX${decryptPan(user.panEncrypted).slice(-4)}`
      } catch (err) {
        // A bad key must not break the flag; the app only needs to know it was submitted.
        logger.error({ err, userId }, 'mobileAuth.getKycStatus: could not decrypt PAN to mask it')
      }
    }
    return { completed: user.panEncrypted !== null && user.dateOfBirth !== null, available: isPanKeyConfigured(), dateOfBirth, panMasked }
  }

  /** Changes date of birth and/or PAN after they were first submitted. Never log the values. */
  async updateKyc(userId: string, data: UpdateKycDTO): Promise<void> {
    this.assertKycAvailable()
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { deletedAt: true } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')

    // Conditional on "already submitted", so an edit can never be the first save (that is POST /me/kyc).
    const updated = await this.db.user.updateMany({
      where: { id: userId, panEncrypted: { not: null } },
      data: {
        ...(data.dateOfBirth ? { dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00.000Z`) } : {}),
        ...(data.panNumber ? { panEncrypted: encryptPan(data.panNumber) } : {}),
      },
    })
    if (updated.count === 0) {
      throw new ConflictError('Submit your date of birth and PAN first.', 'KYC_NOT_SUBMITTED')
    }
    logger.info({ userId, changed: [data.dateOfBirth ? 'dateOfBirth' : null, data.panNumber ? 'pan' : null].filter(Boolean) }, 'mobileAuth.updateKyc: success')
  }

  private async linkIdentity(
    tx: Prisma.TransactionClient,
    userId: string,
    social: { provider: SocialProvider; sub: string; email: string | null },
  ): Promise<void> {
    await tx.authIdentity.create({
      data: { userId, provider: social.provider, providerUserId: social.sub, email: social.email, emailVerified: social.email !== null },
    })
  }

  // Every community ever paid for (excluding the free community and
  // soft-deleted communities), one row each — the latest subscription's
  // expiry, regardless of whether it's still active. Deliberately does NOT
  // filter on isActive/validUntil >= today (that's fetchUserCommunities'
  // job, for current-access decisions) since a lapsed community should still
  // show up here with a past expiresAt rather than disappearing.
  private async fetchPaidCommunities(userId: string): Promise<PaidCommunityDTO[]> {
    const grouped = await this.db.subscription.groupBy({
      by: ['communityId'],
      where: { userId, community: { isFree: false, deletedAt: null } },
      _max: { validUntil: true },
    })
    if (grouped.length === 0) return []

    const communities = await this.db.community.findMany({
      where: { id: { in: grouped.map(g => g.communityId) } },
      select: { id: true, name: true, slug: true, description: true, tags: true, coverImageUrl: true, badgeUrl: true },
    })
    const expiryByCommunity = new Map(grouped.map(g => [g.communityId, g._max.validUntil!]))
    const invoiceByCommunity = await latestInvoiceByCommunity(this.db, userId, communities.map(c => c.id))

    return communities
      .map(c => ({ ...c, expiresAt: expiryByCommunity.get(c.id)!.toISOString().split('T')[0]!, invoice: invoiceByCommunity.get(c.id) ?? null }))
      .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))
  }

  private async fetchUserCommunities(userId: string): Promise<CommunityInfoDTO[]> {
    const subscriptions = await this.db.subscription.findMany({
      where: { userId, isActive: true, ...notExpired(startOfToday()) },
      select: {
        community: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            tags: true,
            coverImageUrl: true,
            badgeUrl: true,
            _count: { select: { subscriptions: { where: { isActive: true } } } },
          },
        },
      },
    })
    return subscriptions.map(s => {
      const { _count, ...community } = s.community
      return { ...community, memberCount: _count.subscriptions }
    })
  }

  private async hasActiveSubscription(userId: string): Promise<boolean> {
    const count = await this.db.subscription.count({
      where: { userId, isActive: true, ...notExpired(startOfToday()) },
    })
    return count > 0
  }

  private async computeAccessibleCommunityIds(userId: string, role: string): Promise<string[] | null> {
    if (role !== 'admin') return []
    return getAccessibleCommunityIds(this.db, userId)
  }

  private toPublicUser(user: DbUser): PublicUserDTO {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email!, // guaranteed once passwordHash is set — see the DbUser.email comment on auth.service.ts's own type
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      avatarUrl: user.avatarUrl,
      postNotificationsEnabled: user.postNotificationsEnabled,
    }
  }

  /**
   * Writes (or rewrites, on resend) the full pending-registration record —
   * payload plus a freshly generated OTP — under `token`, and emails the
   * code. Used by both register() (first write) and resendOtp() (rewrite
   * with the same payload), so the two can never drift on TTLs or on what
   * counts as "still pending."
   */
  async storePendingRegistration(token: string, data: PendingRegistrationInput): Promise<void> {
    const otp = generateOtp()
    // TEMP DEBUG (remove once email delivery is confirmed working): logs the raw OTP so it
    // can be read straight from the logs without depending on the email actually arriving.
    // Do not leave this in long-term — anyone with log access can complete a registration.
    logger.warn({ token, phone: data.phone, email: data.email, otp }, 'mobileAuth.storePendingRegistration: DEBUG OTP VALUE')
    const record: PendingRegistration = { ...data, otpHash: hashOtp(otp), otpAttempts: 0 }
    await this.redis.set(pendingRegistrationKey(token), JSON.stringify(record), 'EX', OTP_TTL_SECONDS)
    await this.redis.set(pendingRegistrationCooldownKey(token), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS)

    try {
      await notificationsQueue.add(
        OTP_WHATSAPP_JOB,
        { phone: data.phone, otp, email: data.email, name: data.fullName, expiryMinutes: OTP_TTL_SECONDS / 60 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, token }, 'mobileAuth.storePendingRegistration: failed to enqueue OTP WhatsApp job')
      throw err
    }
  }
}
