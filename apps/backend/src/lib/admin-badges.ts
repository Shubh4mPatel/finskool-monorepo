import redis from './redis.js'
import { BADGES_PUBSUB_CHANNEL } from './queue.js'
import type { BadgesRefreshEvent } from './queue.js'
import { logger } from '../shared/logger.js'

/** The three numbers in the admin sidebar. Pushed over /ws/tickets as `{ event: 'badges.updated', ...AdminBadges }`. */
export interface AdminBadges {
  /** This admin's unread notifications. */
  notifications: number
  /** Open support tickets that no admin has taken yet, in the communities this admin can see. */
  tickets: number
  /** Open service requests (Enquiries) that no admin has taken yet. The same for every admin. */
  services: number
}

/** Who the counts are for: what a ticket count is scoped by, and who "mine" means. */
export interface BadgeViewer {
  id: string
  isSuperAdmin: boolean
  /** null = every community (super admin). */
  accessibleCommunityIds: string[] | null
}

/**
 * Tells the live feed to recompute and push these admins' sidebar badges. Needed only for changes nothing else
 * announces (ticket, service and new-notification events already trigger it). Never throws: a missed refresh
 * only means a badge is stale until the next event.
 */
export async function refreshAdminBadges(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  try {
    await redis.publish(BADGES_PUBSUB_CHANNEL, JSON.stringify({ userIds } satisfies BadgesRefreshEvent))
  } catch (err) {
    logger.error({ err }, 'refreshAdminBadges: failed to publish')
  }
}
