import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Redis } from 'ioredis'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { Prisma } from '../../generated/prisma/client.js'
import { env } from '../../config/env.js'
import { socialLinkKey, socialSignupKey } from '../../lib/redis.js'
import { hitRateLimit } from '../../lib/rate-limit.js'
import { verifySocialToken } from '../../lib/social-token.js'
import type { SocialProvider } from '../../lib/social-token.js'
import { logger } from '../../shared/logger.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../../shared/errors/index.js'
import type { MobileAuthService } from './mobile-auth.service.js'
import type { MobileLoginResultInternal } from './mobile-auth.dto.js'

const STEP_TTL_SECONDS = 15 * 60
const MAX_LINK_PASSWORD_ATTEMPTS = 5
const BCRYPT_ROUNDS = 12
const OTP_TTL_SECONDS = 10 * 60

export interface DeviceFields {
  deviceId?: string | undefined
  deviceType?: 'ios' | 'android' | undefined
  fcmToken?: string | undefined
  appVersion?: string | undefined
}
export interface RequestMeta {
  userAgent: string | undefined
  ip: string | undefined
}

export type SocialLoginResult =
  | ({ status: 'logged_in' } & MobileLoginResultInternal)
  | { status: 'link_required'; linkToken: string; email: string }
  | { status: 'phone_required'; signupToken: string; email: string; name: string | null }

interface SignupStep {
  provider: SocialProvider
  sub: string
  email: string
  name: string | null
}
interface LinkStep extends SignupStep {
  userId: string
  attempts: number
}

type LoginUser = { id: string; name: string; phone: string; email: string | null; passwordHash: string | null; role: string; isSuperAdmin: boolean; avatarUrl: string | null; postNotificationsEnabled: boolean; status: string; deletedAt: Date | null }

/**
 * "Continue with Google / Apple" for the mobile app. It never creates or changes an account from the token alone:
 *  - a login the member linked before just logs in (same checks and session as a password login);
 *  - an existing password account must confirm its password once before Google is linked to it;
 *  - everyone else gives a phone and confirms the WhatsApp OTP first. If an admin already added that phone, that
 *    same account (with its paid plans) is the one that gets linked, not a second one.
 */
export class SocialAuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    private readonly mobile: MobileAuthService,
  ) {}

  private assertEnabled(): void {
    if (!env.social.enabled) throw new NotFoundError('Sign-in with Google or Apple is not available yet.', 'SOCIAL_LOGIN_DISABLED')
  }

  /** Same refusals as password login, with the same wording. */
  private assertMayLogin(user: Pick<LoginUser, 'status' | 'deletedAt'>): void {
    if (user.deletedAt) throw new UnauthorizedError('Invalid email or password')
    if (user.status !== 'active') throw new UnauthorizedError('Your account has been deactivated. Please contact your admin.')
  }

  async login(input: { provider: SocialProvider; idToken: string; nonce?: string | undefined; fullName?: string | undefined } & DeviceFields, meta: RequestMeta): Promise<SocialLoginResult> {
    this.assertEnabled()
    await hitRateLimit(this.redis, `rl:social-login:ip:${meta.ip ?? 'unknown'}`, 30, 10 * 60)
    const claims = await verifySocialToken(input.provider, input.idToken, input.nonce)

    const identity = await this.db.authIdentity.findUnique({
      where: { uq_auth_identities_provider_sub: { provider: claims.provider, providerUserId: claims.sub } },
      include: { user: true },
    })
    if (identity) {
      this.assertMayLogin(identity.user)
      await this.db.authIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: new Date(), email: claims.email ?? identity.email } })
      logger.info({ userId: identity.userId, provider: claims.provider }, 'socialAuth.login: known identity')
      return { status: 'logged_in', ...(await this.mobile.completeLogin(identity.user, input, meta)) }
    }

    // An identity we have not seen. Without a verified email we cannot tell whose it is, so nothing is matched or created.
    if (!claims.email || !claims.emailVerified) {
      throw new BadRequestError('Your Google or Apple account has no verified email address, so it cannot be used to sign in.', 'SOCIAL_EMAIL_UNVERIFIED')
    }

    const sameEmail = await this.db.user.findUnique({ where: { email: claims.email } })
    // A registered account (it has a password) owns this email: prove it with the password before linking.
    // An account that has no password yet was only added by an admin and never registered: it can be claimed only
    // through its phone, so it goes down the phone path below, never straight to "linked".
    if (sameEmail && !sameEmail.deletedAt && sameEmail.passwordHash) {
      this.assertMayLogin(sameEmail)
      const linkToken = randomUUID()
      const step: LinkStep = { provider: claims.provider, sub: claims.sub, email: claims.email, name: claims.name, userId: sameEmail.id, attempts: 0 }
      await this.redis.set(socialLinkKey(linkToken), JSON.stringify(step), 'EX', STEP_TTL_SECONDS)
      return { status: 'link_required', linkToken, email: claims.email }
    }

    const signupToken = randomUUID()
    const name = claims.name ?? input.fullName ?? null
    const step: SignupStep = { provider: claims.provider, sub: claims.sub, email: claims.email, name }
    await this.redis.set(socialSignupKey(signupToken), JSON.stringify(step), 'EX', STEP_TTL_SECONDS)
    return { status: 'phone_required', signupToken, email: claims.email, name }
  }

  /** The member typed the password of the existing account that owns the Google email: link Google to it and log in. */
  async link(input: { linkToken: string; password: string } & DeviceFields, meta: RequestMeta): Promise<SocialLoginResult> {
    this.assertEnabled()
    await hitRateLimit(this.redis, `rl:social-link:ip:${meta.ip ?? 'unknown'}`, 30, 10 * 60)
    const key = socialLinkKey(input.linkToken)
    const raw = await this.redis.get(key)
    if (!raw) throw new BadRequestError('This step has expired. Please sign in with Google again.', 'SOCIAL_STEP_EXPIRED')
    const step = JSON.parse(raw) as LinkStep
    if (step.attempts >= MAX_LINK_PASSWORD_ATTEMPTS) {
      await this.redis.del(key)
      throw new TooManyRequestsError('Too many wrong passwords. Please sign in with Google again.', 'SOCIAL_LINK_LOCKED')
    }

    const user = await this.db.user.findUnique({ where: { id: step.userId } })
    if (!user || !user.passwordHash) throw new BadRequestError('This step has expired. Please sign in with Google again.', 'SOCIAL_STEP_EXPIRED')
    this.assertMayLogin(user)

    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      const ttl = await this.redis.ttl(key)
      await this.redis.set(key, JSON.stringify({ ...step, attempts: step.attempts + 1 } satisfies LinkStep), 'EX', ttl > 0 ? ttl : STEP_TTL_SECONDS)
      throw new UnauthorizedError('Incorrect password.', 'SOCIAL_LINK_PASSWORD_INVALID')
    }

    await this.redis.del(key)
    try {
      await this.db.authIdentity.create({
        data: { userId: user.id, provider: step.provider, providerUserId: step.sub, email: step.email, emailVerified: true },
      })
    } catch (err) {
      // Linked meanwhile (a second tap): fine if it is this same account, otherwise someone else holds it.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
      const owner = await this.db.authIdentity.findUnique({ where: { uq_auth_identities_provider_sub: { provider: step.provider, providerUserId: step.sub } } })
      if (owner?.userId !== user.id) throw new ConflictError('This Google account is already linked to another member.', 'SOCIAL_ALREADY_LINKED')
    }
    logger.info({ userId: user.id, provider: step.provider }, 'socialAuth.link: linked after password confirmation')
    return { status: 'logged_in', ...(await this.mobile.completeLogin(user, input, meta)) }
  }

  /** New person (or an admin-added member): validate the phone and send the WhatsApp OTP. Nothing is created yet. */
  async startPhone(input: { signupToken: string; phone: string; fullName?: string | undefined }, meta: RequestMeta): Promise<{ otpToken: string; phone: string; otpExpiresInSeconds: number }> {
    this.assertEnabled()
    await hitRateLimit(this.redis, `rl:social-phone:ip:${meta.ip ?? 'unknown'}`, 20, 60 * 60)
    await hitRateLimit(this.redis, `rl:social-phone:phone:${input.phone}`, 5, 60 * 60)
    const raw = await this.redis.get(socialSignupKey(input.signupToken))
    if (!raw) throw new BadRequestError('This step has expired. Please sign in with Google again.', 'SOCIAL_STEP_EXPIRED')
    const step = JSON.parse(raw) as SignupStep

    const fullName = (input.fullName ?? step.name ?? '').trim()
    if (fullName.length < 2) throw new BadRequestError('Please enter your full name.', 'NAME_REQUIRED')

    // The same rules as password registration, so an admin-added phone behaves exactly as it does there.
    const existing = await this.db.user.findUnique({ where: { phone: input.phone } })
    let existingUserId: string | null = null
    if (existing) {
      if (existing.passwordHash) {
        throw new ConflictError(
          'This phone number is already registered. Log in with your password, then connect Google from your profile.',
          'ALREADY_REGISTERED',
        )
      }
      if (existing.status !== 'active') throw new ForbiddenError('Your access has been revoked. Please contact your admin.', 'PHONE_INACTIVE')
      if (step.email !== existing.email) {
        const emailTaken = await this.db.user.findFirst({ where: { email: step.email, id: { not: existing.id } } })
        if (emailTaken) throw new ConflictError('This email address is already registered', 'EMAIL_TAKEN')
      }
      existingUserId = existing.id
    } else {
      const emailTaken = await this.db.user.findFirst({ where: { email: step.email } })
      if (emailTaken) throw new ConflictError('This email address is already registered', 'EMAIL_TAKEN')
    }

    // No password exists for this account. This unguessable hash keeps every "has a password means registered"
    // check working; the member can set a real password later through "Forgot password".
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS)
    const otpToken = randomUUID()
    await this.mobile.storePendingRegistration(otpToken, {
      fullName,
      phone: input.phone,
      email: step.email,
      passwordHash,
      existingUserId,
      social: { provider: step.provider, sub: step.sub, email: step.email, signupToken: input.signupToken },
    })
    logger.info({ otpToken, adminAdded: existingUserId !== null }, 'socialAuth.startPhone: OTP sent')
    return { otpToken, phone: input.phone, otpExpiresInSeconds: OTP_TTL_SECONDS }
  }

  /** The OTP is right: create (or claim) the account, link the identity, then log in, all in one call. */
  async verifyOtp(input: { otpToken: string; otp: string } & DeviceFields, meta: RequestMeta): Promise<SocialLoginResult> {
    this.assertEnabled()
    const { userId, pending } = await this.mobile.confirmOtp(input.otpToken, input.otp, true)
    if (pending.social) await this.redis.del(socialSignupKey(pending.social.signupToken))
    logger.info({ userId, provider: pending.social?.provider }, 'socialAuth.verifyOtp: account created or claimed and linked')
    await this.mobile.notifyAdminsOfRegistration(userId, pending)
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } })
    return { status: 'logged_in', ...(await this.mobile.completeLogin(user, input, meta)) }
  }

  /** A logged-in member adds Google / Apple to their own account (for example after "this phone is already registered"). */
  async linkToAccount(userId: string, input: { provider: SocialProvider; idToken: string; nonce?: string | undefined }): Promise<{ linkedProviders: string[] }> {
    this.assertEnabled()
    const claims = await verifySocialToken(input.provider, input.idToken, input.nonce)
    const owner = await this.db.authIdentity.findUnique({ where: { uq_auth_identities_provider_sub: { provider: claims.provider, providerUserId: claims.sub } } })
    if (owner && owner.userId !== userId) throw new ConflictError('This account is already linked to another member.', 'SOCIAL_ALREADY_LINKED')
    if (!owner) {
      const sameProvider = await this.db.authIdentity.findFirst({ where: { userId, provider: claims.provider } })
      if (sameProvider) throw new ConflictError('A different account of this kind is already linked to you.', 'SOCIAL_PROVIDER_ALREADY_LINKED')
      await this.db.authIdentity.create({
        data: { userId, provider: claims.provider, providerUserId: claims.sub, email: claims.email, emailVerified: claims.emailVerified },
      })
    }
    const rows = await this.db.authIdentity.findMany({ where: { userId }, select: { provider: true } })
    return { linkedProviders: rows.map(r => r.provider) }
  }
}
