import type { Prisma } from '../generated/prisma/client.js'

/**
 * Filter for a subscription that has not run out as of `cutoff` (start of today).
 *
 * `validUntil` is null for the free community: it has no expiry, so a null date counts as not expired. Spread it into a
 * `where` that already requires `isActive: true`. Do not use a bare `validUntil: { gte }` for access checks, it drops
 * the free community's rows.
 */
export function notExpired(cutoff: Date): Pick<Prisma.SubscriptionWhereInput, 'OR'> {
  return { OR: [{ validUntil: null }, { validUntil: { gte: cutoff } }] }
}
