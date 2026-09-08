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
  OTP_EMAIL_JOB,
  PASSWORD_RESET_OTP_EMAIL_JOB,
  MOBILE_NEW_LOGIN_EMAIL_JOB,
} from '../../lib/queue.js'
import { logger } from '../../shared/logger.js'
import { getAccessibleCommunityIds } from '../../lib/community-access.js'
import {
  ConflictError,
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
  otpHash: string
  otpAttempts: number
}

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
      if (!existing.isActive) {
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
    if (!user.isActive) {
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
    const deviceName = parseDeviceName(meta.userAgent)

    const sessionData = {
      sessionIdHash,
      deviceId: data.deviceId ?? null,
      deviceType: data.deviceType ?? null,
      deviceName,
      ip: meta.ip ?? null,
      communityIds,
      selectedCommunityId,
      // Prisma's typed Json input rejects a bare `null` (ambiguous with
      // "field omitted") — Prisma.JsonNull is the explicit "store JSON null"
      // sentinel, used here for the super-admin/"unrestricted" case.
      accessibleCommunityIds: accessibleCommunityIds ?? Prisma.JsonNull,
    }
    await this.db.mobileSession.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...sessionData },
      update: sessionData,
    })

    try {
      await notificationsQueue.add(
        MOBILE_NEW_LOGIN_EMAIL_JOB,
        { toEmail: user.email!, name: user.name, deviceName, loginAt: new Date().toISOString() },
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
   * Mobile equivalent of AuthService.selectCommunity() — but since there's no
   * access token to re-sign, this just updates the cached fields on the
   * user's MobileSession row directly.
   */
  async selectCommunity(userId: string, communityId: string): Promise<void> {
    const communities = await this.fetchUserCommunities(userId)
    const communityIds = communities.map(c => c.id)
    if (!communityIds.includes(communityId)) {
      throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
    }

    const updated = await this.db.mobileSession.updateMany({
      where: { userId },
      data: { selectedCommunityId: communityId, communityIds },
    })
    if (updated.count === 0) {
      throw new UnauthorizedError('No active mobile session found. Please log in again.', 'SESSION_INVALIDATED')
    }
  }

  /**
   * `token` is whatever register() returned as `userId` — a Redis-only
   * reference, not a Users.id (see register()'s own doc comment). Confirming
   * the code here is what actually creates/updates the User row; nothing in
   * Postgres exists for this registration before this call succeeds.
   */
  async verifyOtp(token: string, otp: string): Promise<void> {
    const raw = await this.redis.get(pendingRegistrationKey(token))
    if (!raw) {
      throw new BadRequestError(
        'This code has expired. Please request a new one.',
        'OTP_EXPIRED',
      )
    }

    const pending = JSON.parse(raw) as PendingRegistration
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
    logger.info({ userId, phone: pending.phone }, 'mobileAuth.verifyOtp: success, account created')
  }

  /**
   * The only place a mobile-registered User row is ever created or given its
   * password. Re-validates against Postgres fresh rather than trusting
   * anything cached in `pending` — several minutes may have passed since
   * register() ran (an admin could have revoked the phone, someone else
   * could have grabbed the email).
   */
  private async finalizeRegistration(pending: PendingRegistration): Promise<string> {
    try {
      return await this.db.$transaction(async tx => {
        if (pending.existingUserId) {
          // Freshness check, not a race guard (that's the updateMany below) —
          // an admin could have revoked this phone sometime in the last few
          // minutes since register() ran.
          const current = await tx.user.findUnique({
            where: { id: pending.existingUserId },
            select: { isActive: true },
          })
          if (!current) {
            throw new NotFoundError('This phone number is no longer available. Please register again.')
          }
          if (!current.isActive) {
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
            data: { name: pending.fullName, email: pending.email, isRegistered: true, status: 'registered' },
          })
          return pending.existingUserId
        }

        // Brand new phone — nobody added it, so this is a User row with no
        // matching ApprovedPhone, by design: ApprovedPhone is the admin
        // module's own membership roster/addressing scheme (every
        // suspend/resetPassword/updateMember/revokeMemberCommunity call in
        // admin.service.ts takes an approvedPhoneId, not a userId), which
        // doesn't apply to someone no admin has touched. The consequence:
        // this account is invisible to the admin members list/exports and
        // can't be suspended, password-reset, or granted a community
        // subscription from the admin side — admin.addMember() itself
        // refuses on any already-active phone, so there is currently no
        // admin path that grants this user access to a paid community
        // after the fact. Postgres's unique constraint on `phone` (caught
        // as P2002 below) is what protects against two concurrent
        // registrations for the same never-before-seen number.
        const created = await tx.user.create({
          data: {
            phone: pending.phone,
            name: pending.fullName,
            email: pending.email,
            passwordHash: pending.passwordHash,
          },
        })
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
    const eligible = !!user && !user.deletedAt && user.isActive && !!user.passwordHash
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
    if (!user || user.deletedAt || !user.isActive) {
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
    if (!user || user.deletedAt || !user.isActive) {
      throw new BadRequestError('This reset session is no longer valid.', 'RESET_TOKEN_INVALID')
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash } })

    logger.info({ userId: user.id }, 'mobileAuth.resetPassword: success')
  }

  private async fetchUserCommunities(userId: string): Promise<CommunityInfoDTO[]> {
    const subscriptions = await this.db.subscription.findMany({
      where: { userId, isActive: true, validUntil: { gte: startOfToday() } },
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
      where: { userId, isActive: true, validUntil: { gte: startOfToday() } },
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
  private async storePendingRegistration(
    token: string,
    data: { fullName: string; phone: string; email: string; passwordHash: string; existingUserId: string | null },
  ): Promise<void> {
    const otp = generateOtp()
    const record: PendingRegistration = { ...data, otpHash: hashOtp(otp), otpAttempts: 0 }
    await this.redis.set(pendingRegistrationKey(token), JSON.stringify(record), 'EX', OTP_TTL_SECONDS)
    await this.redis.set(pendingRegistrationCooldownKey(token), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS)

    try {
      await notificationsQueue.add(
        OTP_EMAIL_JOB,
        { toEmail: data.email, name: data.fullName, otp, expiryMinutes: OTP_TTL_SECONDS / 60 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
      )
    } catch (err) {
      logger.error({ err, token }, 'mobileAuth.storePendingRegistration: failed to enqueue OTP email job')
      throw err
    }
  }
}
