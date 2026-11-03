import type { Redis } from 'ioredis'
import { TooManyRequestsError } from '../shared/errors/index.js'

/**
 * Fixed-window counter in Redis: counts this call and throws 429 once `limit` calls were made in the last
 * `windowSeconds`. The window starts with the first call. Used on endpoints that cost money or can be guessed
 * at (WhatsApp OTPs, password checks). Fails open if Redis errors, so a Redis blip never locks everyone out.
 */
export async function hitRateLimit(redis: Redis, key: string, limit: number, windowSeconds: number): Promise<void> {
  let count: number
  try {
    count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSeconds)
  } catch {
    return
  }
  if (count > limit) throw new TooManyRequestsError('Too many attempts. Please wait a while and try again.', 'RATE_LIMITED')
}
