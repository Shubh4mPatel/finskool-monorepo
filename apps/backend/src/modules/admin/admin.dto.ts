export type DuplicateStrategy = 'skip' | 'overwrite'

export interface AddMemberDTO {
  phone: string
  name: string
  email: string
  communityId: string
  payment: number
  validUntil: string   // ISO date string YYYY-MM-DD
}

export interface AddMemberResultDTO {
  approvedPhoneId: string
  phone: string
  name: string
  email: string
  communityId: string
  validUntil: string
}

export interface CommunityDTO {
  id: string
  name: string
  slug: string
  coverImageUrl: string | null
}

// Status is derived, not stored
export type MemberStatus = 'registered' | 'pending' | 'expired' | 'suspended'

export interface MemberListFilters {
  communityId?: string | undefined
  status?: MemberStatus | undefined
  validFrom?: string | undefined
  validTo?: string | undefined
  paidFrom?: string | undefined
  paidTo?: string | undefined
  search?: string | undefined
  page: number
  pageSize: number
}

export interface MemberItemDTO {
  id: string            // approvedPhone.id
  name: string
  phone: string
  email: string
  isActive: boolean
  isRegistered: boolean
  status: MemberStatus
  createdAt: string
  subscription: {
    id: string
    communityId: string
    communityName: string
    payment: number
    paidOn: string | null
    validUntil: string
    isActive: boolean
  } | null
}

export interface MemberListDTO {
  members: MemberItemDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ImportRowDTO {
  name: string
  phone: string
  email: string
  service: string
  payment: number
  valid: string           // YYYY-MM-DD
  paidOn?: string | undefined  // YYYY-MM-DD
}

export interface ImportErrorDTO {
  row: number
  phone: string
  reason: string
}

export interface ImportSummaryDTO {
  total: number
  created: number
  updated: number
  skipped: number
  errors: ImportErrorDTO[]
}

export interface CommentNotificationAuthorDTO {
  id: string
  name: string
  avatarUrl: string | null
}

export interface CommentNotificationPostDTO {
  id: string
  title: string
}

export interface CommentNotificationItemDTO {
  id: string
  isReplied: boolean
  repliedAt: Date | null
  createdAt: Date
  comment: {
    id: string
    content: string
    author: CommentNotificationAuthorDTO
    createdAt: Date
  }
  post: CommentNotificationPostDTO
}

export interface DashboardCommunityBreakdownItem {
  communityId: string
  communityName: string
  memberCount: number
  registeredCount: number
  registrationPercentage: number
}

export interface DashboardExpiringSoonItem {
  userId: string
  name: string
  initials: string
  communityId: string
  communityName: string
  validUntil: string
  daysLeft: number
}

export interface DashboardDTO {
  stats: {
    totalMembers: number
    activeSubscriptions: number
    pendingRegistration: number
    expiringThisWeek: number
    unresolvedThreads: number
  }
  communityBreakdown: DashboardCommunityBreakdownItem[]
  expiringSoon: DashboardExpiringSoonItem[]
}

export interface CommentNotificationListDTO {
  notifications: CommentNotificationItemDTO[]
  nextCursor: string | null
  hasMore: boolean
}
