import type { PostMediaShapeDTO, PostVideoDTO } from '../posts/posts.dto.js'
export type DuplicateStrategy = 'skip' | 'overwrite'

export interface AddMemberDTO {
  phone: string
  name: string
  email?: string | undefined
  communityId: string
  // Both are required for every community except the free one, which has no price and no expiry.
  payment?: number | undefined
  validUntil?: string | undefined   // ISO date string YYYY-MM-DD
}

export interface AddMemberResultDTO {
  approvedPhoneId: string
  phone: string
  name: string
  email: string | null
  communityId: string
  validUntil: string | null   // null for the free community
}

export interface ExtendSubscriptionDTO {
  validUntil: string   // ISO date string YYYY-MM-DD
  payment: number
  paidOn?: string | undefined       // ISO date string YYYY-MM-DD, defaults to today
}

export interface ExtendSubscriptionResultDTO {
  /** True when the new end date is earlier than the plan's running end date, so the member was told it was reduced. */
  reduced: boolean
  id: string
  userId: string
  communityId: string
  payment: number
  paidOn: string | null
  validUntil: string
  isActive: boolean
}

export interface DeleteMemberResultDTO {
  userId: string
  approvedPhoneId: string | null   // present only for an admin-added member
  phone: string
  isActive: boolean        // always false on success
}

export interface BulkDeleteMembersDTO {
  userIds: string[]
}

export interface BulkDeleteMembersResultDTO {
  total: number
  succeeded: number
  failed: number
  errors: { userId: string; reason: string }[]
}

export interface BlockMemberInCommunityDTO {
  reason: string
}

/** A member's block in one community: their account and every other community stay usable. */
export interface MemberCommunityBlockDTO {
  reason: string
  blockedAt: string   // ISO
}

export interface CommunityBlockResultDTO {
  userId: string
  communityId: string
  blocked: boolean               // true after a block, false after an unblock
  reason: string | null          // null after an unblock
  blockedAt: string | null
}

export interface SuspendMemberDTO {
  reason: string
}

export interface SuspendMemberResultDTO {
  userId: string
  approvedPhoneId: string | null
  isActive: boolean          // always false on success
  suspensionReason: string
}

export interface RevokeSuspensionResultDTO {
  userId: string
  approvedPhoneId: string | null
  isActive: boolean          // always true on success
}

export interface CommunityDTO {
  id: string
  name: string
  slug: string
  description: string | null
  tags: string[]
  type: string | null
  coverImageUrl: string | null
  badgeUrl: string | null
  paymentLink: string | null
  isFree: boolean
  memberCount: number
}

export interface CreateCommunityDTO {
  name: string
  slug?: string | undefined
  description?: string | undefined
  tags: string[]
  type?: string | undefined
  whatsIncluded?: string[] | undefined
  coverImageUrl?: string | undefined
  badgeUrl?: string | undefined
  paymentLink?: string | undefined
}

export interface UpdateCommunityDTO {
  name: string
  description?: string | undefined
  tags: string[]
  type?: string | undefined
  whatsIncluded?: string[] | undefined
  coverImageUrl?: string | undefined
  badgeUrl?: string | undefined
  paymentLink?: string | undefined
}

export interface PlanDTO {
  id: string
  communityId: string
  name: string
  durationMonths: number
  price: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  updatedBy: string | null
}

export interface CreatePlanDTO {
  name: string
  durationMonths: number
  price: number
}

export interface UpdatePlanDTO {
  name: string
  durationMonths: number
  price: number
}

export interface AdminUserDTO {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  isSuperAdmin: boolean
  communityAccess: { id: string; name: string; slug: string }[]
}

/** Which admins to list: every admin, only super admins, or only community-scoped admins. */
export type AdminRoleFilter = 'all' | 'super' | 'scoped'

export interface AdminListFilters {
  role: AdminRoleFilter
  /** Matches name or email, case-insensitively. */
  search?: string | undefined
  /** Admins who can manage this community — which includes every super admin. */
  communityId?: string | undefined
  /**
   * Paging is opt-in: give `page` and/or `pageSize` to get one page (defaults 1 and 10), give neither to get every
   * match. The reassign pickers on the ticket and service screens rely on the second form.
   */
  page?: number | undefined
  pageSize?: number | undefined
}

export interface AdminListDTO {
  /** The admins matching every filter, alphabetical: one page of them when paging was asked for, else all. */
  items: AdminUserDTO[]
  /** Admins matching every filter, across all pages. */
  total: number
  page: number
  pageSize: number
  totalPages: number
  /**
   * Admins per role among those matching `search` and `communityId` (but ignoring `role`), so the
   * tabs' numbers always agree with what each tab would list.
   */
  counts: { all: number; super: number; scoped: number }
}

export interface CreateAdminDTO {
  name: string
  email: string
  phone: string
  password: string
  communityIds: string[]
}

export interface UpdateAdminAccessDTO {
  communityIds: string[]
}

// Old admin-facing display status — a single computed value conflating account
// standing, registration progress, and subscription validity into one of 5
// strings. Demoted: no longer part of MemberItemDTO (see below, which exposes
// the 3 underlying facts independently instead) — kept only as the CSV
// export's column-label vocabulary, see AdminService#memberStatusLabel.
export type MemberStatus = 'registered' | 'pending' | 'expired' | 'suspended' | 'deleted'

export interface MemberListFilters {
  communityId?: string | undefined
  communityIds?: string[] | undefined
  // The account's own standing — User.status directly. Left out, deleted members are not listed or counted.
  accountStatus?: 'active' | 'suspended' | 'deleted' | undefined
  // Has this admin-added phone been claimed — ApprovedPhone.status directly.
  // By construction this can only ever match admin-added members: a
  // self-registered member has no ApprovedPhone row, so this field is always
  // `null` for them (see MemberItemDTO) and can never equal 'pending' or
  // 'registered'. Applying this filter therefore implicitly restricts results
  // to source: 'admin' — passing `source: 'admin'` alongside it is a no-op.
  registrationStatus?: 'pending' | 'registered' | undefined
  // Whether their current subscription (any community) is active and not
  // past validUntil — independent of accountStatus/registrationStatus, since
  // "expired" was never really an account-standing fact (see UserStatus's
  // doc comment in schema.prisma).
  hasActiveSubscription?: boolean | undefined
  // Was this member added by an admin (has an ApprovedPhone row) or did they
  // self-register via the mobile app (no ApprovedPhone at all)? The only way
  // to isolate self-registered members — see registrationStatus above.
  source?: 'admin' | 'self' | undefined
  validFrom?: string | undefined
  validTo?: string | undefined
  paidFrom?: string | undefined
  paidTo?: string | undefined
  // Current subscription's validUntil falls within [today, today+7] — independent of
  // the other filters, since a suspended/pending member can still have a soon-to-expire subscription.
  expiringIn7Days?: boolean | undefined
  search?: string | undefined
  page: number
  pageSize: number
}

export type MemberExportFilters = Omit<MemberListFilters, 'page' | 'pageSize'>

/** The three cards at the top of the Members page. Each equals the `total` the list returns for the matching filter. */
export interface MemberStatsDTO {
  /** Every member (no filter). */
  total: number
  /** `hasActiveSubscription=true`: a current, unexpired subscription. */
  registered: number
  /** `registrationStatus=pending`: added by an admin, has not signed up yet. */
  pending: number
}

export interface MemberSubscriptionDTO {
  id: string
  communityId: string
  communityName: string
  /** The free community: part of every account, it cannot be suspended on its own. */
  isFree: boolean
  payment: number
  paidOn: string | null
  validUntil: string | null   // null = no expiry (the free community)
  isActive: boolean
  block: MemberCommunityBlockDTO | null   // set while an admin has blocked the member in this community
}

export interface MemberItemDTO {
  id: string                        // User.id (was ApprovedPhone.id)
  approvedPhoneId: string | null    // present only when source === 'admin'
  source: 'admin' | 'self'
  name: string
  phone: string
  email: string | null
  avatarUrl: string | null
  accountStatus: 'active' | 'suspended' | 'deleted'
  registrationStatus: 'pending' | 'registered' | null   // null for source === 'self'
  hasActiveSubscription: boolean
  createdAt: string                 // now User.createdAt uniformly
  suspensionReason: string | null   // set only when suspended via suspendMember(); null otherwise (incl. deleted)
  subscription: MemberSubscriptionDTO | null   // most recent active subscription (for status / extend)
  allSubscriptions: MemberSubscriptionDTO[]    // all active subscriptions (one UI row per entry)
}

export interface UpdateMemberDTO {
  name: string
  phone: string
  email?: string | undefined
  newCommunity?: {
    communityId: string
    payment?: number | undefined      // required unless the community is the free one
    paidOn?: string | undefined       // YYYY-MM-DD, defaults to today
    validUntil?: string | undefined   // YYYY-MM-DD, required unless the community is the free one
  } | undefined
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
  email?: string | undefined
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

export interface ValidateImportRowInput {
  rowNum: number
  name: string
  phone: string
  email: string
  service: string
  payment: number
  valid: string
  paidOn?: string | undefined
}

export interface ValidateImportRowResult {
  rowNum: number
  errors: string[]    // blocking — format / missing field
  warnings: string[]  // non-blocking — duplicate exists
  isDuplicate: boolean
  // Set only when the row's phone matches an existing User whose account isn't
  // active. 'suspended'/'deleted' rows need an explicit admin decision — see
  // reviveRowNums on importUsersFromJSON — rather than silently reviving during
  // a bulk import; 'active'/undefined need no decision (normal update-or-create).
  existingStatus?: 'suspended' | 'deleted' | undefined
}

export interface ValidateImportDTO {
  results: ValidateImportRowResult[]
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
  communityId: string
  communityName: string
}

export interface MarkAllRepliedDTO {
  count: number
}

export interface PostThreadSummaryDTO extends PostMediaShapeDTO {
  id: string
  title: string
  contentMd: string
  imageUrls: string[]
  videos: PostVideoDTO[]
  tags: string[]
  publishedAt: Date | null
  createdAt: Date
  communityId: string
  communityName: string
  communityBadgeUrl: string | null
  authorName: string
  authorAvatarUrl: string | null
  totalComments: number
  pendingThreads: number
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

export interface CommentNotificationListDTO {
  notifications: CommentNotificationItemDTO[]
  nextCursor: string | null
  hasMore: boolean
}
