# Sign in with Google and Apple (mobile)

The member taps "Continue with Google" (or Apple). The app gets an **ID token** from the provider and sends it to the server. The server checks it and tells the app what to do next. Nothing is created or linked from the token alone.

Base path: `/api/v1/auth/mobile`. None of these calls (except the last) needs a session. The calls are switched off on the server until `SOCIAL_LOGIN_ENABLED=true`; while off they answer `404 SOCIAL_LOGIN_DISABLED`, so keep the buttons hidden until the server says go.

## The flow in one picture

```
Continue with Google ──► POST /social/login
                           │
        ┌──────────────────┼───────────────────────┐
   status: logged_in   status: link_required   status: phone_required
   (done, cookie set)  (an account with this    (new person, or a member an admin added)
                        email exists)                 │
                           │                    ask for the phone
                    ask for that                      │
                    account's password       POST /social/phone  ──► WhatsApp OTP
                           │                          │
                    POST /social/link        POST /social/verify-otp
                           │                          │
                      logged in                   logged in
```

Every path that finishes returns the **same body as password login** (`user`, `communities`) plus `status: "logged_in"`, and sets the same session cookie. After that, the app behaves exactly as after a password login (push token, notifications, KYC flag, plans).

## Step 1: `POST /social/login`

```json
{ "provider": "google", "idToken": "<ID token>", "nonce": "<random value>",
  "deviceId": "…", "deviceType": "android", "deviceName": "Pixel 8", "location": "Mumbai, India",
  "fcmToken": "…", "appVersion": "1.4.0" }
```

Only `provider` and `idToken` are required. Apple: also send `fullName` the first time (Apple gives the name to the app once, and not inside the token).

**Always send a `nonce`.** Generate a random string for each sign-in, give Google/Apple its SHA-256 hash (Apple requires this form) or the raw value, and send the raw value here. The server rejects a token that does not carry it, so a stolen token cannot be replayed.

Answer (HTTP 200), look at `data.status`:

| `status` | Meaning | What the app does |
|---|---|---|
| `logged_in` | This Google/Apple login is already linked to a member. Cookie set. | Go to the home screen. |
| `phone_required` | New here (or an admin added this member but they never registered). Returns `signupToken`, `email`, `name`. | Show "Enter your phone number" (prefill the name; ask for it if `name` is null). Go to step 2b. |
| `link_required` | A registered account with this verified email exists. Returns `linkToken`, `email`. | Show "Enter your password to connect Google". Go to step 2a. |

## Step 2a: `POST /social/link` (only after `link_required`)

```json
{ "linkToken": "…", "password": "the password of that account", "deviceId": "…", "fcmToken": "…" }
```

Right password: Google is linked and the member is logged in (body as step 1, `status: logged_in`). Wrong password: `401 SOCIAL_LINK_PASSWORD_INVALID`. After 5 wrong passwords the token is dead (`429 SOCIAL_LINK_LOCKED`): start again from step 1. The member can use "Forgot password" if they do not remember it.

## Step 2b: `POST /social/phone` (only after `phone_required`)

```json
{ "signupToken": "…", "phone": "+919876543210", "fullName": "only if the provider gave no name" }
```

Returns `{ "otpToken": "…", "phone": "…", "otpExpiresInSeconds": 600 }` and sends a 6-digit OTP on WhatsApp. To resend the code call the existing `POST /auth/mobile/resend-otp` with `{ "userId": "<otpToken>" }` (60 second wait between sends).

Errors:

| Code | Meaning | Message idea |
|---|---|---|
| `409 ALREADY_REGISTERED` | This phone belongs to a registered account | "This number already has an account. Log in with your password, then connect Google from your profile." |
| `409 EMAIL_TAKEN` | The Google email belongs to someone else's account | "This email is already used." |
| `403 PHONE_INACTIVE` | Access revoked by an admin | "Contact support." |
| `400 NAME_REQUIRED` | No name available | Ask for the full name and resend. |
| `400 SOCIAL_STEP_EXPIRED` | The 15 minute step expired | Start again from step 1. |
| `429 RATE_LIMITED` | Too many OTP requests for this phone or device | Ask them to wait. |

## Step 3: `POST /social/verify-otp`

```json
{ "otpToken": "…", "otp": "123456", "deviceId": "…", "fcmToken": "…" }
```

Right code: the account is created (or the admin-added account is claimed), Google is linked, the member is logged in. Body as step 1 with `status: "logged_in"`. Errors: `400 OTP_INVALID` (wrong code), `400 OTP_EXPIRED`, `429 OTP_LOCKED` (5 wrong codes: request a new code).

### A member an admin added earlier

If an admin added this member by phone (with a paid plan), nothing about that changes:

- Signing in with Google never links or logs in by email alone. The member still gives the phone and confirms the OTP.
- With the **same phone** the admin added, the member gets **that same account**, with the plan the admin gave, not a second one. Google is simply linked to it.
- If the Google email is different from the one the admin typed, the account's email becomes the Google one.
- Someone who has only the Google account, but not the phone, cannot get in: the OTP goes to the phone's WhatsApp.

## Link Google to the account you are logged in to: `POST /me/social/link`

Needs the session cookie. Use it when step 2b answered `ALREADY_REGISTERED`: the member logs in with the password, then taps "Connect Google" in the profile.

```json
{ "provider": "google", "idToken": "…", "nonce": "…" }
```

Returns `{ "linkedProviders": ["google"] }`. `409 SOCIAL_ALREADY_LINKED` if that Google account belongs to another member, `409 SOCIAL_PROVIDER_ALREADY_LINKED` if a different Google account is already linked. `GET /me` now includes `user.linkedProviders`.

## Other errors for steps 1 to 3

| Code | Meaning |
|---|---|
| `401 SOCIAL_TOKEN_INVALID` | The token is bad, expired, for another app, or the nonce did not match. Ask the member to try again. |
| `400 SOCIAL_EMAIL_UNVERIFIED` | The provider account has no verified email. |
| `401` "account has been deactivated" | Suspended or deleted member, same as password login. |
| `429 RATE_LIMITED` | Too many attempts from this device/network. |

## Members who signed up with Google have no password

They can log in with Google every time. If they ever want a password (for example to use the email login), the existing **Forgot password** flow works for them and sets one.

## Flutter sketch

```dart
// Google: serverClientId is the *Web* OAuth client ID, so the token's audience is the one the server expects.
final google = GoogleSignIn(scopes: ['email'], serverClientId: webClientId);
final account = await google.signIn();
final idToken = (await account!.authentication).idToken;

// Apple: hash the nonce for Apple, send the raw nonce to our server.
final raw = generateNonce();
final cred = await SignInWithApple.getAppleIDCredential(
  scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
  nonce: sha256.convert(utf8.encode(raw)).toString(),
);
final name = [cred.givenName, cred.familyName].whereType<String>().join(' ');
// send cred.identityToken as idToken, raw as nonce, and name as fullName
```

Never log the ID token. Never store it; use it once.

## Setup the account owner must do

**Google (Google Cloud console, same project as Firebase):**
1. OAuth consent screen: app name, logo, support email, then **publish** it (in testing mode only listed users can sign in).
2. Create OAuth client IDs: **Web** (the app passes this one as `serverClientId`), **Android** (package name + SHA-1 of the debug key, the upload key **and** the Play App Signing key, found in Play Console, Setup, App integrity), **iOS** (bundle ID).
3. Put all IDs in the server's `GOOGLE_CLIENT_IDS`, comma separated.

**Apple:** in the Apple developer account enable "Sign in with Apple" on the App ID, add the capability in Xcode, and put the bundle ID in `APPLE_BUNDLE_IDS`.

**Server `.env`:** `SOCIAL_LOGIN_ENABLED=true`, `GOOGLE_CLIENT_IDS=…`, `APPLE_BUNDLE_IDS=…`, then recreate the backend container. Apple requires an app that has sign-in to also let people delete their account from inside the app; that is not built yet.

## Test results (2026-11-03, local server with a fake key server, no real Google account)

68 checks passed: new member through Google, phone and OTP; an admin-added member linked to the **same** account after the phone OTP (same user id, paid plan intact, no second account, approved phone marked registered, a stranger with the same Google email but another phone refused); password account linked after confirming the password (5 wrong passwords lock it); 15 token checks (wrong audience, issuer, key, expiry, nonce, `alg: none`, unverified email); Apple (first login with the name from the app, later login with no email); suspended and deleted members refused; 12 simultaneous OTP confirmations give one account; rate limits; password registration, admin-added password registration and password login unchanged; no token or password in the logs.
