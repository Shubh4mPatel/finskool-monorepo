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
  // What the phone is ("Pixel 8") and where it is ("Mumbai, India"), for the new-login email. Both optional;
  // without a device name the one read from the request's user agent is used.
  deviceName?: string | undefined
  location?: string | undefined
  // FCM device token for push notifications (optional; can also be sent later via PUT /mobile/push-token).
  fcmToken?: string | undefined
  appVersion?: string | undefined
}

// Type-only reuse of the web auth module's response shapes (not its logic) —
// login() here is a self-contained duplicate of AuthService.login(), kept
// separate on purpose (see mobile-auth.service.ts).
import type { PublicUserDTO, CommunityInfoDTO } from '../auth/auth.dto.js'
export type { PublicUserDTO, CommunityInfoDTO, AuthResponseDTO, PaidCommunityDTO, MobileProfileDTO } from '../auth/auth.dto.js'

// Internal only — used between service and controller to pass the raw
// session id for cookie-setting. No JWT/access-refresh pair for mobile —
// see mobile-auth.service.ts's login() for why.
export interface MobileLoginResultInternal {
  sessionId: string
  user: PublicUserDTO
  communities: CommunityInfoDTO[]
}

export interface KycStatusDTO {
  /** true once both date of birth and PAN are saved: the app stops asking. */
  completed: boolean
  /** false when the server cannot save these details right now (its encryption key is not set): the app should not ask yet. */
  available: boolean
  dateOfBirth: string | null
  /** PAN with all but the last 4 characters hidden, e.g. XXXXXX234F. The full PAN is never returned. */
  panMasked: string | null
}

export interface UpdateKycDTO {
  dateOfBirth?: string | undefined
  panNumber?: string | undefined
}

export interface SubmitKycDTO {
  dateOfBirth: string // YYYY-MM-DD
  panNumber: string   // already trimmed + upper-cased by submitKycSchema
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
