import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import { refreshTokenKey, selectedCommunityKey } from '../../lib/redis.js'
import { env } from '../../config/env.js'
import { logger } from '../../shared/logger.js'
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../../shared/errors/index.js'
import type {
  AuthTokensInternal,
  AuthResponseDTO,
  LoginDTO,
  PublicUserDTO,
  CommunityInfoDTO,
  RegisterDTO,
} from './auth.dto.js'
import type { JwtPayload } from '../../middlewares/auth.middleware.js'

const BCRYPT_ROUNDS = 12

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}


type DbUser = {
  id: string
  name: string
  phone: string
  email: string
  role: string
  avatarUrl: string | null
}

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async register(data: RegisterDTO): Promise<AuthTokensInternal> {
    logger.info({ phone: data.phone }, 'auth.register: attempt')

    if (data.password !== data.confirmPassword) {
      throw new BadRequestError('Passwords do not match')
    }

    const approved = await this.db.approvedPhone.findUnique({ where: { phone: data.phone } })
    if (!approved) {
      throw new ForbiddenError(
        'This phone number is not in the list. Please contact your admin.',
        'PHONE_NOT_APPROVED',
      )
    }
    if (!approved.isActive) {
      throw new ForbiddenError(
        'Your access has been revoked. Please contact your admin.',
        'PHONE_INACTIVE',
      )
    }
    if (approved.isRegistered) {
      throw new ConflictError(
        'This phone number has already been registered. Please log in.',
        'ALREADY_REGISTERED',
      )
    }

    const existingEmail = await this.db.user.findUnique({ where: { email: data.email } })
    if (existingEmail) throw new ConflictError('This email address is already registered')

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS)
    const user = await this.db.user.create({
      data: { name: data.fullName, phone: data.phone, email: data.email, passwordHash },
    })

    await this.db.approvedPhone.update({
      where: { phone: data.phone },
      data: { isRegistered: true },
    })

    logger.info({ userId: user.id }, 'auth.register: success')
    return this.issueTokens(user)
  }

  async login(data: LoginDTO): Promise<AuthTokensInternal> {
    logger.info({ phone: data.phone }, 'auth.login: attempt')

    const user = await this.db.user.findUnique({ where: { phone: data.phone } })
    if (!user || user.deletedAt) {
      throw new UnauthorizedError('Invalid phone number or password')
    }
    if (!user.isActive) {
      throw new UnauthorizedError('Your account has been deactivated. Please contact your admin.')
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash)
    if (!valid) {
      logger.warn({ phone: data.phone }, 'auth.login: invalid password')
      throw new UnauthorizedError('Invalid phone number or password')
    }

    logger.info({ userId: user.id }, 'auth.login: success')
    return this.issueTokens(user)
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: JwtPayload
    try {
      // Refresh token has no exp — verify only checks signature
      payload = jwt.verify(refreshToken, env.jwt.secret) as JwtPayload
    } catch {
      throw new UnauthorizedError('Invalid refresh token')
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type')
    }

    const tokenHash = hashToken(refreshToken)
    const stored = await this.redis.get(refreshTokenKey(tokenHash))
    if (!stored || stored !== payload.sub) {
      throw new UnauthorizedError('Refresh token revoked or not found')
    }

    const user = await this.db.user.findUnique({ where: { id: payload.sub } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')

    const communities = await this.fetchUserCommunities(user.id)
    const communityIds = communities.map(c => c.id)

    // Restore previously selected community (validate it's still a valid subscription)
    const savedComm = await this.redis.get(selectedCommunityKey(user.id))
    const selectedCommunityId = savedComm && communityIds.includes(savedComm) ? savedComm : (communityIds.length === 1 ? (communityIds[0] ?? null) : null)

    const accessToken = this.signToken(
      { sub: user.id, role: user.role as 'admin' | 'member', type: 'access', communityIds, selectedCommunityId },
      env.jwt.accessExpiresIn,
    )
    return { accessToken }
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken)
    await this.redis.del(refreshTokenKey(tokenHash))
  }

  async getMe(userId: string): Promise<AuthResponseDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')
    const communities = await this.fetchUserCommunities(user.id)
    return { user: this.toPublicUser(user), communities }
  }

  async selectCommunity(userId: string, communityId: string, currentCommunityIds: string[]): Promise<string> {
    if (!currentCommunityIds.includes(communityId)) {
      throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
    }
    // Persist selection so token refresh can restore it
    await this.redis.set(selectedCommunityKey(userId), communityId)

    const communities = await this.fetchUserCommunities(userId)
    const communityIds = communities.map(c => c.id)
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedError('User not found')

    return this.signToken(
      { sub: userId, role: user.role as 'admin' | 'member', type: 'access', communityIds, selectedCommunityId: communityId },
      env.jwt.accessExpiresIn,
    )
  }

  private async issueTokens(user: DbUser): Promise<AuthTokensInternal> {
    const role = user.role as 'admin' | 'member'
    const communities = await this.fetchUserCommunities(user.id)
    const communityIds = communities.map(c => c.id)

    // Auto-select the only community; for multiple communities user must select manually
    const selectedCommunityId = communityIds.length === 1 ? (communityIds[0] ?? null) : null
    if (selectedCommunityId) {
      await this.redis.set(selectedCommunityKey(user.id), selectedCommunityId)
    }

    const accessToken = this.signToken(
      { sub: user.id, role, type: 'access', communityIds, selectedCommunityId },
      env.jwt.accessExpiresIn,
    )
    // Refresh token has no expiry in the JWT — Redis presence is the sole validity gate
    const refreshToken = jwt.sign(
      { sub: user.id, role, type: 'refresh' } as object,
      env.jwt.secret,
    )

    const tokenHash = hashToken(refreshToken)
    // No TTL — refresh token is permanent until logout or admin suspension
    await this.redis.set(refreshTokenKey(tokenHash), user.id)

    return { accessToken, refreshToken, user: this.toPublicUser(user), communities }
  }

  private async fetchUserCommunities(userId: string): Promise<CommunityInfoDTO[]> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    })
    if (!user) return []

    const approvedPhone = await this.db.approvedPhone.findUnique({
      where: { phone: user.phone },
      select: {
        subscriptions: {
          where: { isActive: true },
          select: { community: { select: { id: true, name: true, slug: true } } },
        },
      },
    })

    return approvedPhone?.subscriptions.map(s => s.community) ?? []
  }

  private signToken(payload: JwtPayload, expiresIn: string): string {
    return jwt.sign(payload as object, env.jwt.secret, { expiresIn } as jwt.SignOptions)
  }

  private toPublicUser(user: DbUser): PublicUserDTO {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    }
  }
}
