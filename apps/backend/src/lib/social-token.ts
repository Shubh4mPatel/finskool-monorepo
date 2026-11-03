import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { env } from '../config/env.js'
import { UnauthorizedError } from '../shared/errors/index.js'
import { logger } from '../shared/logger.js'

export type SocialProvider = 'google' | 'apple'

export interface SocialClaims {
  provider: SocialProvider
  /** The provider's own user id. Never changes, so it (not the email) identifies the login. */
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

// jose caches the keys and re-fetches them when a token names a key it has not seen (providers rotate them).
const keySets = new Map<string, JWTVerifyGetKey>()
function keysFor(url: string): JWTVerifyGetKey {
  let keys = keySets.get(url)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000, cooldownDuration: 30_000 })
    keySets.set(url, keys)
  }
  return keys
}

const ISSUERS: Record<SocialProvider, string[]> = {
  google: ['https://accounts.google.com', 'accounts.google.com'],
  apple: ['https://appleid.apple.com'],
}

const invalid = () => new UnauthorizedError('We could not verify your sign-in. Please try again.', 'SOCIAL_TOKEN_INVALID')

/**
 * Checks a Google / Apple ID token: signature (against the provider's published keys), issuer, audience
 * (must be one of our own client / bundle IDs) and expiry. When the app sends the nonce it signed in with,
 * the token must carry it (either as is, or SHA-256 hashed as Apple does), so a stolen token cannot be replayed.
 * Nothing about the token is logged.
 */
export async function verifySocialToken(provider: SocialProvider, idToken: string, nonce?: string): Promise<SocialClaims> {
  const audiences = provider === 'google' ? env.social.googleClientIds : env.social.appleBundleIds
  if (audiences.length === 0) {
    logger.error({ provider }, 'social login: no client IDs configured for this provider')
    throw new UnauthorizedError('Sign-in with this provider is not available right now.', 'SOCIAL_PROVIDER_UNAVAILABLE')
  }
  const jwksUrl = provider === 'google' ? env.social.googleJwksUrl : env.social.appleJwksUrl
  let payload
  try {
    ;({ payload } = await jwtVerify(idToken, keysFor(jwksUrl), { issuer: ISSUERS[provider], audience: audiences, algorithms: ['RS256'] }))
  } catch (err) {
    logger.warn({ provider, reason: err instanceof Error ? err.name : 'unknown' }, 'social login: token rejected')
    throw invalid()
  }

  if (nonce) {
    const claimed = typeof payload['nonce'] === 'string' ? payload['nonce'] : null
    const hashed = createHash('sha256').update(nonce).digest('hex')
    if (claimed !== nonce && claimed !== hashed) {
      logger.warn({ provider }, 'social login: nonce mismatch')
      throw invalid()
    }
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) throw invalid()
  const email = typeof payload['email'] === 'string' && payload['email'] ? payload['email'].toLowerCase() : null
  // Apple sends email_verified as the string "true"; Google as a boolean.
  const verified = payload['email_verified'] === true || payload['email_verified'] === 'true'
  return {
    provider,
    sub,
    email,
    emailVerified: email !== null && verified,
    name: typeof payload['name'] === 'string' && payload['name'].trim() ? payload['name'].trim().slice(0, 100) : null,
  }
}
