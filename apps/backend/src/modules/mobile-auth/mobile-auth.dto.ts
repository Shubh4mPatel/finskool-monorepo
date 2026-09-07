// Re-exported so callers don't need to reach into the web auth module just to
// share the registration shape — same fields, same validation as auth.dto.ts's
// RegisterDTO, kept as its own type here since the two flows are expected to
// diverge (e.g. this one will eventually carry a channel: 'email' | 'whatsapp').
export interface MobileRegisterDTO {
  fullName: string
  phone: string
  email: string
  password: string
  confirmPassword: string
}

export interface MobileRegisterResponseDTO {
  userId: string
  phone: string
  email: string
  otpExpiresInSeconds: number
}

export interface VerifyOtpDTO {
  userId: string
  otp: string
}

export interface ResendOtpDTO {
  userId: string
}

export interface MobileLoginDTO {
  email: string
  password: string
  // Client-supplied, best-effort — stored on the MobileSession row for
  // display/support purposes only, never used for auth decisions.
  deviceId?: string | undefined
  deviceType?: 'ios' | 'android' | undefined
}

// Type-only reuse of the web auth module's response shapes (not its logic) —
// login() here is a self-contained duplicate of AuthService.login() with one
// extra isPhoneVerified gate, kept separate on purpose (see mobile-auth.service.ts).
import type { PublicUserDTO, CommunityInfoDTO } from '../auth/auth.dto.js'
export type { PublicUserDTO, CommunityInfoDTO, AuthResponseDTO } from '../auth/auth.dto.js'

// Internal only — used between service and controller to pass the raw
// session id for cookie-setting. No JWT/access-refresh pair for mobile —
// see mobile-auth.service.ts's login() for why.
export interface MobileLoginResultInternal {
  sessionId: string
  user: PublicUserDTO
  communities: CommunityInfoDTO[]
}

export interface MobileSelectCommunityDTO {
  communityId: string
}

export interface ForgotPasswordDTO {
  email: string
}

export interface VerifyResetOtpDTO {
  email: string
  otp: string
}

export interface VerifyResetOtpResponseDTO {
  cypher: string
  cypherExpiresInSeconds: number
}

export interface ResetPasswordDTO {
  cypher: string
  newPassword: string
  confirmNewPassword: string
}
