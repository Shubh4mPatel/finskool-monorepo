import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../shared/logger.js'

const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password || undefined,
  db: env.redis.db,
  lazyConnect: true,
})

redis.on('connect', () => logger.info('redis connected'))
redis.on('error', (err: unknown) => logger.error({ err }, 'redis error'))

export const REFRESH_TOKEN_PREFIX = 'refresh:'

export function refreshTokenKey(tokenHash: string): string {
  return `${REFRESH_TOKEN_PREFIX}${tokenHash}`
}

export function selectedCommunityKey(userId: string): string {
  return `selected_comm:${userId}`
}

export function feedCacheKey(communityId: string, page: number): string {
  return `feed:${communityId}:page:${page}`
}

export function likeCountKey(postId: string): string {
  return `like_count:${postId}`
}

// Mobile self-serve registration OTP (email-based for now — a stand-in until
// WhatsApp delivery is wired up). Keyed by userId, not phone, since by the
// time an OTP exists the user row already exists.
export function otpKey(userId: string): string {
  return `otp:register:${userId}`
}

export function otpCooldownKey(userId: string): string {
  return `otp:register:cooldown:${userId}`
}

// Mobile forgot-password OTP — keyed by (lowercased) email, not userId, since
// the "send OTP" endpoint deliberately never reveals whether a userId exists
// for that email (see mobile-auth.service.ts#forgotPassword).
export function passwordResetOtpKey(email: string): string {
  return `otp:reset:${email}`
}

export function passwordResetOtpCooldownKey(email: string): string {
  return `otp:reset:cooldown:${email}`
}

// The one-time "cypher" issued after a successful forgot-password OTP verify.
// Keyed by a hash of the cypher itself (never the raw value — same reasoning
// as refreshTokenKey) and resolves to the userId allowed to reset their
// password with it, standing in for a real auth session for that one call.
export function passwordResetCypherKey(cypherHash: string): string {
  return `reset_cypher:${cypherHash}`
}

export default redis
