export interface RegisterDTO {
  fullName: string
  phone: string
  email: string
  password: string
  confirmPassword: string
}

export interface LoginDTO {
  phone: string
  password: string
}

export interface AuthTokensDTO {
  accessToken: string
  refreshToken: string
  user: PublicUserDTO
}

export interface PublicUserDTO {
  id: string
  name: string
  phone: string
  email: string
  role: string
  avatarUrl: string | null
}
