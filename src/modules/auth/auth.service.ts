import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import { refreshTokenKey } from '../../lib/redis.js'
import { env } from '../../config/env.js'
import { logger } from '../../shared/logger.js'
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../../shared/errors/index.js'
import type { AuthTokensDTO, LoginDTO, PublicUserDTO, RegisterDTO } from './auth.dto.js'
import type { JwtPayload } from '../../middlewares/auth.middleware.js'

const BCRYPT_ROUNDS = 12

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function refreshTtlSeconds(): number {
  const raw = env.jwt.refreshExpiresIn
  const match = /^(\d+)([smhd])$/.exec(raw)
  if (!match) throw new Error('Invalid JWT_REFRESH_EXPIRES_IN format')
  const value = Number(match[1])
  const unit = match[2] as 's' | 'm' | 'h' | 'd'
  return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit]
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

  async register(data: RegisterDTO): Promise<AuthTokensDTO> {
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

    const [existingPhone, existingEmail] = await Promise.all([
      this.db.user.findUnique({ where: { phone: data.phone } }),
      this.db.user.findUnique({ where: { email: data.email } }),
    ])

    if (existingPhone) throw new ConflictError('This phone number is already registered')
    if (existingEmail) throw new ConflictError('This email address is already registered')

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS)
    const user = await this.db.user.create({
      data: { name: data.fullName, phone: data.phone, email: data.email, passwordHash },
    })

    logger.info({ userId: user.id }, 'auth.register: success')
    return this.issueTokens(user)
  }

  async login(data: LoginDTO): Promise<AuthTokensDTO> {
    logger.info({ phone: data.phone }, 'auth.login: attempt')

    const user = await this.db.user.findUnique({ where: { phone: data.phone } })
    if (!user || user.deletedAt) {
      throw new UnauthorizedError('Invalid phone number or password')
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
      payload = jwt.verify(refreshToken, env.jwt.secret) as JwtPayload
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token')
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

    const accessToken = this.signToken(
      { sub: user.id, role: user.role as 'admin' | 'member', type: 'access' },
      env.jwt.accessExpiresIn,
    )
    return { accessToken }
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken)
    await this.redis.del(refreshTokenKey(tokenHash))
  }

  async getMe(userId: string): Promise<PublicUserDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt) throw new UnauthorizedError('User not found')
    return this.toPublicUser(user)
  }

  private async issueTokens(user: DbUser): Promise<AuthTokensDTO> {
    const role = user.role as 'admin' | 'member'
    const accessToken = this.signToken({ sub: user.id, role, type: 'access' }, env.jwt.accessExpiresIn)
    const refreshToken = this.signToken({ sub: user.id, role, type: 'refresh' }, env.jwt.refreshExpiresIn)

    const tokenHash = hashToken(refreshToken)
    await this.redis.setex(refreshTokenKey(tokenHash), refreshTtlSeconds(), user.id)

    return { accessToken, refreshToken, user: this.toPublicUser(user) }
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
