import type { Redis } from 'ioredis'
import { REFRESH_TOKEN_PREFIX } from './redis.js'
import { logger } from '../shared/logger.js'

/**
 * Ends every web session of one user. Refresh tokens are stored as `refresh:<hash> -> userId` with no index by
 * user, so this walks the `refresh:*` keys and deletes the ones that belong to `userId`. Used after a password
 * reset: whoever knew the old password (or held a stolen session) must not stay signed in.
 *
 * Best effort and never throws: the password is already changed by the time this runs, so a Redis error is logged
 * and the reset still succeeds. Access tokens already issued stay valid until they expire (15 minutes).
 */
export async function revokeRefreshTokensFor(redis: Redis, userId: string): Promise<number> {
  let revoked = 0
  try {
    let cursor = '0'
    do {
      const page = await redis.scan(cursor, 'MATCH', `${REFRESH_TOKEN_PREFIX}*`, 'COUNT', 500)
      if (!page) break
      const [next, keys] = page
      cursor = next
      if (keys.length === 0) continue
      const owners = await redis.mget(...keys)
      const mine = keys.filter((_, i) => owners[i] === userId)
      if (mine.length > 0) revoked += await redis.del(...mine)
    } while (cursor !== '0')
  } catch (err) {
    logger.error({ err, userId }, 'revokeRefreshTokensFor: failed')
  }
  return revoked
}
