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
  avatarUrl: string | null
  postNotificationsEnabled: boolean
}

export interface UpdateEmailDTO {
  email: string
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
  memberCount: number
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
