export interface RegisterDTO {
  fullName: string
  phone: string
  email: string
  password: string
  confirmPassword: string
}

export interface LoginDTO {
  email: string
  password: string
}

export interface PublicUserDTO {
  id: string
  name: string
  phone: string
  email: string
  role: string
  isSuperAdmin: boolean
  avatarUrl: string | null
  postNotificationsEnabled: boolean
}

export interface UpdateEmailDTO {
  email: string
}

export interface UpdateNameDTO {
  name: string
}

export interface ChangePasswordDTO {
  currentPassword: string
  newPassword: string
}

export interface UpdateNotificationsDTO {
  postNotificationsEnabled: boolean
}

export interface CommunityInfoDTO {
  id: string
  name: string
  slug: string
  description: string | null
  tags: string[]
  coverImageUrl: string | null
  badgeUrl: string | null
  memberCount: number
}

// A community the caller has ever paid for, purchase-history style (unlike
// CommunityInfoDTO, which reflects current access only) — used by
// GET /auth/mobile/me. expiresAt is the latest subscription's validUntil for
// this community, past or future, so a lapsed/unrenewed community still
// appears rather than disappearing from the list.
export interface PaidCommunityDTO {
  id: string
  name: string
  slug: string
  description: string | null
  tags: string[]
  coverImageUrl: string | null
  badgeUrl: string | null
  expiresAt: string
}

export interface MobileProfileDTO {
  user: {
    avatarUrl: string | null
    email: string
    phone: string
    postNotificationsEnabled: boolean
  }
  communities: PaidCommunityDTO[]
}

// Returned in response body — tokens are in httpOnly cookies, not here
export interface AuthResponseDTO {
  user: PublicUserDTO
  communities: CommunityInfoDTO[]
}

// Internal only — used between service and controller to pass tokens for cookie-setting
export interface AuthTokensInternal {
  accessToken: string
  refreshToken: string
  user: PublicUserDTO
  communities: CommunityInfoDTO[]
}
