export type StrategyNoticeType = 'normal' | 'warning'

// Shapes stored in the community_kits JSON columns (see the CommunityKit model comment).
export interface WatchBeforeYouStart {
  introMarkdown: string
  youtubeUrls: string[]
}

export interface CapitalStrategyItem {
  priority: number
  value: string
  label: string
}

export interface CapitalAllocation {
  heroStat: string
  description: string
  strategyTitle: string
  strategies: CapitalStrategyItem[]
}

export interface StrategyNotice {
  priority: number
  type: StrategyNoticeType
  heading: string
  description: string
}

export interface WhatYouGetItem {
  priority: number
  text: string
}

/** What the admin UI sends. Lists arrive in display order; `priority` is assigned server-side. */
export interface UpsertWelcomeKitDTO {
  watchBeforeYouStart: WatchBeforeYouStart
  capitalAllocation: {
    heroStat: string
    description: string
    strategyTitle: string
    strategies: { value: string; label: string }[]
  }
  strategyNotices: { type: StrategyNoticeType; heading: string; description: string }[]
  whatYouGet: { text: string }[]
}

export interface WelcomeKitDTO {
  communityId: string
  communityName: string
  watchBeforeYouStart: WatchBeforeYouStart | null
  capitalAllocation: CapitalAllocation | null
  strategyNotices: StrategyNotice[]
  whatYouGet: WhatYouGetItem[]
  updatedAt: Date
}

export interface WelcomeKitListItemDTO {
  communityId: string
  name: string
  slug: string
  type: string | null
  coverImageUrl: string | null
  badgeUrl: string | null
  hasKit: boolean
  updatedAt: Date | null
}

export interface MobileWelcomeKitVideoDTO {
  url: string
  videoId: string
  embedUrl: string
  thumbnailUrl: string | null
}

export interface MobileWelcomeKitDTO {
  communityId: string
  communityName: string
  watchBeforeYouStart: { introMarkdown: string; videos: MobileWelcomeKitVideoDTO[] } | null
  capitalAllocation: CapitalAllocation | null
  strategyNotices: StrategyNotice[]
  whatYouGet: WhatYouGetItem[]
  updatedAt: Date
}
