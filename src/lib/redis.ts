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

export function feedCacheKey(communityId: string, page: number): string {
  return `feed:${communityId}:page:${page}`
}

export function likeCountKey(postId: string): string {
  return `like_count:${postId}`
}

export default redis
