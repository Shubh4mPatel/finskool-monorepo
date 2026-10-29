/**
 * The routing payload every notification carries as `data` (stored on the row, returned by the REST list and
 * the live socket, and sent as the push `data`), so a client can open the right screen without guessing:
 *   { type: <module>, id: <entity id>, communityId?: <community>, event?: <what happened> }
 * Values are strings because FCM data values must be.
 */
export type RoutingData = Record<string, string>

export const RoutingModule = {
  Feed: 'feed',
  Post: 'post',
  Recommendation: 'recommendation',
  Subscription: 'subscription',
  Ticket: 'ticket',
  Service: 'service',
  Member: 'member',
  Members: 'members',
  Threads: 'threads',
  Subscriptions: 'subscriptions',
} as const

interface RoutingParams {
  module: string
  id: string
  communityId: string | null | undefined
  event?: string
  /**
   * The notification belongs to the free community. Its content is the general feed, which is not scoped to
   * a community, so the module becomes `feed` and no `communityId` is sent.
   */
  free?: boolean | undefined
}

export function routingData({ module, id, communityId, event, free }: RoutingParams): RoutingData {
  if (free) return { type: RoutingModule.Feed, id, ...(event ? { event } : {}) }
  return { type: module, id, ...(communityId ? { communityId } : {}), ...(event ? { event } : {}) }
}

/** Membership events (added, extended, expiring, expired). They never apply to the free community, which has no plans. */
export function subscriptionRouting(communityId: string, event: string): RoutingData {
  return routingData({ module: RoutingModule.Subscription, id: communityId, communityId, event })
}
