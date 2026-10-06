import { Prisma } from '../../generated/prisma/client.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { parseVideoLink } from '../../lib/video-links.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  CapitalAllocation,
  MobileWelcomeKitDTO,
  StrategyNotice,
  UpsertWelcomeKitDTO,
  WatchBeforeYouStart,
  WelcomeKitDTO,
  WelcomeKitListItemDTO,
  WhatYouGetItem,
} from './welcome-kits.dto.js'

// The four welcome-kit columns of CommunityKit, as Prisma reads them.
interface KitRow {
  watchBeforeYouStart: Prisma.JsonValue | null
  capitalAllocation: Prisma.JsonValue | null
  strategyNotices: Prisma.JsonValue | null
  whatYouGet: Prisma.JsonValue | null
  updatedAt: Date
}

const byPriority = <T extends { priority: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.priority - b.priority)

/** Display order in, priority 1..n out — no gaps, no duplicates, whatever the client sent. */
const withPriority = <T extends object>(items: T[]): (T & { priority: number })[] =>
  items.map((item, i) => ({ ...item, priority: i + 1 }))

function hasContent(kit: KitRow | null): kit is KitRow {
  return (
    kit !== null &&
    (kit.watchBeforeYouStart !== null ||
      kit.capitalAllocation !== null ||
      kit.strategyNotices !== null ||
      kit.whatYouGet !== null)
  )
}

export class WelcomeKitsService {
  constructor(private readonly db: PrismaClient) {}

  /** A live, paid community — the only kind that has a welcome kit. */
  private async getPaidCommunity(communityId: string): Promise<{ id: string; name: string }> {
    const community = await this.db.community.findUnique({
      where: { id: communityId },
      select: { id: true, name: true, isFree: true, deletedAt: true },
    })
    if (!community || community.deletedAt) throw new NotFoundError('Community not found')
    if (community.isFree) throw new BadRequestError('The free community cannot have a welcome kit')
    return { id: community.id, name: community.name }
  }

  async listForAdmin(accessibleCommunityIds: string[] | null): Promise<WelcomeKitListItemDTO[]> {
    const communities = await this.db.community.findMany({
      where: {
        deletedAt: null,
        isFree: false,
        ...(accessibleCommunityIds !== null && { id: { in: accessibleCommunityIds } }),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        badgeUrl: true,
        kit: {
          select: { watchBeforeYouStart: true, capitalAllocation: true, strategyNotices: true, whatYouGet: true, updatedAt: true },
        },
      },
      orderBy: { name: 'asc' },
    })
    return communities.map(c => {
      const kit = hasContent(c.kit) ? c.kit : null
      return {
        communityId: c.id,
        name: c.name,
        slug: c.slug,
        badgeUrl: c.badgeUrl,
        hasKit: kit !== null,
        updatedAt: kit?.updatedAt ?? null,
      }
    })
  }

  async getForAdmin(accessibleCommunityIds: string[] | null, communityId: string): Promise<WelcomeKitDTO | null> {
    assertCommunityAccessFromToken(accessibleCommunityIds, communityId)
    const community = await this.getPaidCommunity(communityId)
    const kit = await this.db.communityKit.findUnique({ where: { communityId } })
    return hasContent(kit) ? this.toDTO(community, kit) : null
  }

  async upsert(
    accessibleCommunityIds: string[] | null,
    communityId: string,
    data: UpsertWelcomeKitDTO,
  ): Promise<WelcomeKitDTO> {
    assertCommunityAccessFromToken(accessibleCommunityIds, communityId)
    const community = await this.getPaidCommunity(communityId)

    const watchBeforeYouStart: WatchBeforeYouStart = {
      introMarkdown: data.watchBeforeYouStart.introMarkdown,
      youtubeUrls: this.canonicalYoutubeUrls(data.watchBeforeYouStart.youtubeUrls),
    }
    const capitalAllocation: CapitalAllocation = {
      heroStat: data.capitalAllocation.heroStat,
      description: data.capitalAllocation.description,
      strategyTitle: data.capitalAllocation.strategyTitle,
      strategies: withPriority(data.capitalAllocation.strategies),
    }
    const strategyNotices = withPriority(data.strategyNotices)
    const whatYouGet = withPriority(data.whatYouGet)

    const columns = {
      watchBeforeYouStart: watchBeforeYouStart as unknown as Prisma.InputJsonValue,
      capitalAllocation: capitalAllocation as unknown as Prisma.InputJsonValue,
      strategyNotices: strategyNotices as unknown as Prisma.InputJsonValue,
      whatYouGet: whatYouGet as unknown as Prisma.InputJsonValue,
    }
    const kit = await this.db.communityKit.upsert({
      where: { communityId },
      create: { communityId, ...columns },
      update: columns,
    })
    logger.info({ communityId }, 'welcomeKits.upsert: success')
    return this.toDTO(community, kit)
  }

  async delete(accessibleCommunityIds: string[] | null, communityId: string): Promise<void> {
    assertCommunityAccessFromToken(accessibleCommunityIds, communityId)
    await this.getPaidCommunity(communityId)

    const kit = await this.db.communityKit.findUnique({ where: { communityId } })
    if (!hasContent(kit)) throw new NotFoundError('This community has no welcome kit')

    // community_kits also holds other (trading setup / legacy welcome_kit) JSON — only clear ours,
    // and drop the row itself only once nothing else is left in it.
    const cleared = await this.db.communityKit.update({
      where: { communityId },
      data: {
        watchBeforeYouStart: Prisma.DbNull,
        capitalAllocation: Prisma.DbNull,
        strategyNotices: Prisma.DbNull,
        whatYouGet: Prisma.DbNull,
      },
      select: { tradingSetupInfo: true, welcomeKit: true },
    })
    if (cleared.tradingSetupInfo === null && cleared.welcomeKit === null) {
      await this.db.communityKit.delete({ where: { communityId } })
    }
    logger.info({ communityId }, 'welcomeKits.delete: success')
  }

  /**
   * Mobile read. Admins need access to the community; members need an active, unexpired
   * subscription to it — the same rule as PostsService#assertMemberSubscribed.
   */
  async getForMobile(
    user: { id: string; role: string; accessibleCommunityIds: string[] | null },
    communityId: string,
  ): Promise<MobileWelcomeKitDTO> {
    const community = await this.getPaidCommunity(communityId)

    if (user.role === 'admin') {
      assertCommunityAccessFromToken(user.accessibleCommunityIds, communityId)
    } else {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const subscriptions = await this.db.subscription.count({
        where: { userId: user.id, communityId, isActive: true, validUntil: { gte: today } },
      })
      if (subscriptions === 0) {
        throw new ForbiddenError('You do not have an active subscription to this community.', 'SUBSCRIPTION_REQUIRED')
      }
    }

    const kit = await this.db.communityKit.findUnique({ where: { communityId } })
    if (!hasContent(kit)) throw new NotFoundError('This community has no welcome kit yet')

    const dto = this.toDTO(community, kit)
    return {
      communityId: dto.communityId,
      communityName: dto.communityName,
      watchBeforeYouStart: dto.watchBeforeYouStart && {
        introMarkdown: dto.watchBeforeYouStart.introMarkdown,
        videos: dto.watchBeforeYouStart.youtubeUrls.flatMap(url => {
          const parsed = parseVideoLink(url)
          return parsed && parsed.kind === 'youtube'
            ? [{ url: parsed.canonicalUrl, videoId: parsed.externalId, embedUrl: parsed.embedUrl, thumbnailUrl: parsed.thumbnailUrl }]
            : []
        }),
      },
      capitalAllocation: dto.capitalAllocation,
      strategyNotices: dto.strategyNotices,
      whatYouGet: dto.whatYouGet,
      updatedAt: dto.updatedAt,
    }
  }

  /** Every URL must be a real YouTube video; stored in canonical form, duplicates rejected. */
  private canonicalYoutubeUrls(urls: string[]): string[] {
    const seen = new Set<string>()
    return urls.map(raw => {
      const parsed = parseVideoLink(raw)
      if (!parsed || parsed.kind !== 'youtube') throw new BadRequestError(`"${raw}" is not a valid YouTube video link`)
      if (seen.has(parsed.externalId)) throw new BadRequestError('The same YouTube video was added more than once')
      seen.add(parsed.externalId)
      return parsed.canonicalUrl
    })
  }

  private toDTO(community: { id: string; name: string }, kit: KitRow): WelcomeKitDTO {
    const watch = kit.watchBeforeYouStart as unknown as WatchBeforeYouStart | null
    const capital = kit.capitalAllocation as unknown as CapitalAllocation | null
    const notices = (kit.strategyNotices as unknown as StrategyNotice[] | null) ?? []
    const whatYouGet = (kit.whatYouGet as unknown as WhatYouGetItem[] | null) ?? []
    return {
      communityId: community.id,
      communityName: community.name,
      watchBeforeYouStart: watch,
      capitalAllocation: capital && { ...capital, strategies: byPriority(capital.strategies ?? []) },
      strategyNotices: byPriority(notices),
      whatYouGet: byPriority(whatYouGet),
      updatedAt: kit.updatedAt,
    }
  }
}
