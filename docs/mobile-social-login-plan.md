# Plan: Google (and Apple) sign-in for the mobile app

Status: plan, nothing built yet. Decisions below were confirmed on 2026-11-03.

## Decisions already made

| Question | Decision |
|---|---|
| New Google user has no phone | After Google sign-in the app asks for the phone and verifies it with the same WhatsApp OTP as today. The account is created only after the OTP is confirmed. |
| Google email already belongs to a password account | The member must enter that account's password once. Then the Google login is linked. |
| Apple | Designed in from the start (Apple requires "Sign in with Apple" in an iPhone app that offers Google). Same endpoints, a `provider` field. |

## Why it is not just "verify a token"

- Every account is keyed by a **unique phone**, and admins add paid members **by phone**. Google gives a verified email, not a phone. So Google users must still go through the phone step, otherwise a member added by an admin would never match their Google login and would not get the plan they paid for.
- Today `passwordHash` set means "registered" (login, register and the admin-added claim path all read it). A Google user has no password.
- Login is by email + password. The session machinery (one mobile session per user, cookie, FCM token handling, new-login email) must be reused, not copied.
- There is **no API rate limiting** in the backend today. The OTP step must not become a way to spam WhatsApp, so the new endpoints get limits (see Security).

## Design

### Data

New table `auth_identities`:

| Column | Notes |
|---|---|
| `id` | uuid |
| `user_id` | FK to users, cascade delete |
| `provider` | `google` or `apple` |
| `provider_user_id` | the token's `sub` (never changes, unlike the email) |
| `email`, `email_verified` | as reported at last login, for display and support |
| `created_at`, `last_login_at` | |

Unique on (`provider`, `provider_user_id`); index on `user_id`. No change to `users`.

**No password for social accounts.** On creation `password_hash` is a bcrypt hash of 32 random bytes nobody knows. It keeps every "registered" check working unchanged. Side effect (good): "Forgot password" works for them, so a Google member can later set a real password through the email OTP they already have.

### Token verification (`lib/social-token.ts`)

One code path with `jose` and each provider's public keys (JWKS, cached):

| | Google | Apple |
|---|---|---|
| Issuer | `https://accounts.google.com` | `https://appleid.apple.com` |
| Keys | `https://www.googleapis.com/oauth2/v3/certs` | `https://appleid.apple.com/auth/keys` |
| Audience must be | one of `GOOGLE_CLIENT_IDS` | one of `APPLE_BUNDLE_IDS` |

Always checked: signature, issuer, audience, expiry. Optional but recommended: `nonce` (the app sends a random value, hashes it into the sign-in request, and the server compares it) so a stolen token cannot be replayed. Apple quirks: `email` and the name arrive **only the first time** (the app must send the name in the request), and the email may be a private relay address.

### Endpoints (all under `/api/v1/auth/mobile/social`, no session needed)

1. **`POST /login`** `{ provider, idToken, nonce?, deviceId?, deviceType?, fcmToken?, appVersion?, fullName? }`
   Verifies the token, then answers one of three ways (always HTTP 200, field `status`):
   - `logged_in`: the identity is known. Same response and cookie as password login (`user`, `communities`). Same checks: active account, subscription gate, free community granted, FCM token takes over, new-login email.
   - `link_required` `{ linkToken, email }`: no identity yet, the Google email is **verified** and an account with that email exists. The app asks for that account's password.
   - `phone_required` `{ signupToken, name, email }`: brand-new person.
2. **`POST /link`** `{ linkToken, password, device fields… }`: checks the password against the existing account (5 attempts per `linkToken`), creates the identity, and logs in. Returns the same as `logged_in`.
3. **`POST /phone`** `{ signupToken, phone }`: validates the phone like the current register does, then sends the WhatsApp OTP through the existing pending-registration store (extended with the provider and `sub`, no password). Returns `{ otpToken, otpExpiresInSeconds }`.
   - Phone already belongs to a registered account: `409 ALREADY_REGISTERED` ("log in with your password, then link Google from your profile").
   - Phone was added by an admin and not yet registered: allowed, and it claims that account (paid plans attach), exactly like today's register.
4. **`POST /verify-otp`** `{ otpToken, otp, device fields… }`: same OTP rules as today (10 minutes, 5 attempts), creates the user and identity, grants the free community, notifies admins of the new registration (existing event), then logs in and returns the full login payload. This is the one difference from password registration, where the app logs in as a second call.
5. **`POST /resend-otp`**: the existing one is reused.
6. **`POST /me/social/link`** (logged in): add Google or Apple to the current account. `409` if that Google account is already linked to someone else. Needed so a password member who hit `ALREADY_REGISTERED` in step 3 can still add Google.

`GET /me` gains `linkedProviders: ["google"]`. The existing KYC flag works unchanged.

### Code changes

- Extract the session-issuing half of `login()` into one private `issueMobileSession(user, device, meta)` and call it from password login and the four social paths. This is the only refactor of existing code.
- Extend `PendingRegistration` with `social?: { provider, sub }` and a nullable `passwordHash`; `finalizeRegistration` creates the identity in the same transaction as the user.
- New files: `lib/social-token.ts`, `modules/mobile-auth/social-auth.service.ts`, controller and routes block, Prisma migration for `auth_identities`.
- Config: `GOOGLE_CLIENT_IDS` (comma list), `APPLE_BUNDLE_IDS`, `SOCIAL_LOGIN_ENABLED` (a kill switch, default off until the app ships).

## Security rules

- Link or merge **only when `email_verified` is true**. An unverified email never matches an existing account.
- Linking an existing account always needs its password (decision above). No silent merge.
- Identity is the provider `sub`, never the email. A changed Google email does not lock anyone out or open anyone's account.
- `signupToken`, `linkToken` and `otpToken` are single-use, random, and expire (15 minutes).
- Rate limits (new, Redis based): per IP and per device on `/login`, per phone and per IP on `/phone` and `/resend-otp` (the WhatsApp cost), per token on `/link` and `/verify-otp`.
- Never log tokens, OTPs or passwords. Log provider, user id and outcome only.
- Suspended or deleted accounts are refused with the same messages as password login.
- Google and Apple tokens are checked on every call; no long-lived trust in an old token.

## Phases

| # | Work | Size |
|---|---|---|
| 0 | Console setup (below) and env values | small, needs the account owner |
| 1 | Migration, `social-token.ts` with a fake JWKS server for tests | small |
| 2 | Refactor `issueMobileSession`; `/login` and `/link` | medium |
| 3 | `/phone` and `/verify-otp` with the pending-registration extension | medium |
| 4 | `/me/social/link`, `linkedProviders`, rate limiting | small |
| 5 | Apple specifics (first-login name and relay email) | small |
| 6 | Docs for the mobile developer, admin member page shows "Google" tag, final tests | small |

Total: roughly 3 to 4 working days of backend work, plus the mobile app work and store set-up.

## Console set-up (account owner, before phase 2 can be tested end to end)

Google (Google Cloud console, project linked to the Firebase project):
1. OAuth consent screen: app name, logo, support email, publish it (testing mode limits users).
2. Create OAuth client IDs: **Web** (its ID is used as `serverClientId` in the app, so the ID token's audience is this one), **Android** (package name plus SHA-1 of the debug key, the upload key **and** the Play App Signing key), **iOS** (bundle ID).
3. Put all IDs in `GOOGLE_CLIENT_IDS`.

Apple: enable "Sign in with Apple" on the App ID, add the capability in Xcode, set `APPLE_BUNDLE_IDS` to the bundle ID.

## Testing plan

Local, with real Postgres and Redis and a fake key server that signs test tokens, so no Google account is needed:
- new person: `phone_required` then `/phone` then OTP then logged in; identity row, free community, admin notification, push token stored
- same Google login again: `logged_in` without the phone step
- existing password account, verified email: `link_required`, wrong password rejected (and locked after 5), right password links
- unverified email never links
- admin-added phone: claims the account and the paid plan shows up
- phone owned by a registered account: `409`
- suspended or deleted account refused; expired, wrong audience, wrong issuer, bad signature, wrong nonce tokens refused
- token replay across `signupToken`s, double submit of `/verify-otp`, 15 parallel `/verify-otp` (one wins)
- rate limits trip and recover
- password login, registration and KYC still pass their existing tests
- Apple: name sent by the app is used; relay email accepted; no email on a later login still works

## Open points for later

- **Unlinking** Google, and **in-app account deletion** (Apple requires deletion from inside an app that has sign-in).
- Whether Google members should be asked for date of birth and PAN right after the phone step (the existing KYC flag already covers them).
- The admin member page: a small "Google" tag, and a "send reset password link" for social members.
