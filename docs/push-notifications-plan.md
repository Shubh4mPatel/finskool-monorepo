# Push notifications (FCM): feasibility and implementation plan

Status: **built on `feat/push-notifications`** (phases 1 to 4 below). Decisions were confirmed by the product owner on 2026-10-21. Mobile guide: `docs/mobile-push-integration.md`.

## 1. Verdict

**Feasible, and it fits the current system well.** The generic FCM guide assumes a `devices` table with many tokens per user. Our session model allows only **one mobile session per user**, so we simplify: the FCM token lives on the existing `MobileSession` row. That makes the three token-lifecycle rules (login, refresh, logout) almost free, and removes the classic "user B logs in on user A's phone" leak.

Estimated work: about 3 to 4 days backend (plus Firebase/APNs setup by whoever owns the Apple and Firebase accounts), and a mobile guide.

## 2. Decisions (confirmed)

| Question | Decision |
|---|---|
| Who gets pushes | Members only. No admin pushes in v1. |
| Devices per user | **One**, stored on `MobileSession` (matches the single-session rule). |
| App open (socket connected) | **Always send** the push; the app decides how to show it in the foreground. |
| Events | Community posts (not recommendations); ticket replies and resolution from admin; service updates; subscription reminders. |

## 3. How it fits what we already have

| Existing piece | How push uses it |
|---|---|
| `MobileSession` (one row per user, deleted on logout, overwritten on new login) | Holds `fcmToken`. Logout deletes the row, so the token disappears with it. A login on a new phone overwrites it, so the old phone stops getting pushes. No extra cleanup logic. |
| `POST /auth/mobile/login` (already takes `deviceId`, `deviceType`) | Accept an optional `fcmToken` here too, so the very first push after login works without a second call. |
| BullMQ `notificationsQueue` + `worker.ts` | New job `PUSH_NOTIFICATION_JOB`. Sending always goes through the queue with retries and backoff, never inline in an API request. |
| `Notification` table + `createAndPublishNotification` / `notifyOnce` | The in-app inbox ("source of truth"). Push is a nudge on top of it. |
| `fanOutCommunity` (posts; recommendations are in-app and email only, no push) | Already computes recipients and respects `User.postNotificationsEnabled`. Add one push enqueue per chunk. |
| Live sockets (`/ws/tickets`, `/ws/notifications`) | Unchanged. Always-send means push does not need to know about socket presence. |

## 4. Things to know before building (gaps found in the code)

1. **No Firebase code exists** (no `firebase-admin` dependency, no credentials). Needs a Firebase project, a service account JSON, and for iPhones an APNs auth key (.p8) uploaded in the Firebase console.
2. **`Notification.communityId` is required.** Ticket and service events are not community-scoped and have no `Notification` rows today. To give them an in-app inbox entry we must make `communityId` nullable (small migration). Without that they would be push-only with no inbox, which the guide warns against.
3. **Mobile does not use `/ws/notifications`.** That socket authenticates by the web `access_token` cookie only. Mobile reads notifications by REST (`GET /api/v1/notifications`). The inbox therefore stays REST-based for mobile; no change needed.
4. **Session is a cookie** (`mobile_session_id`). The mobile app must therefore send the token with the same authenticated session cookie, exactly like every other mobile call.
5. **`Notification` has a unique `(userId, type, sourceId)`.** Event types that repeat (chat messages) must use a unique `sourceId` per event (message id), otherwise `notifyOnce` skips them.
6. **Chat spam.** A back-and-forth chat could send a push per message. Mitigation: collapse by ticket/request using FCM `collapseKey` / Android `tag` / APNs `apns-collapse-id`, so a new message replaces the previous banner for that thread.
7. **Delivery is best effort.** Mark failed tokens invalid, keep the inbox as truth (see section 8).

## 5. Data model changes

```prisma
model MobileSession {
  // ...existing fields...
  fcmToken            String?   @map("fcm_token") @db.VarChar(512)
  fcmTokenUpdatedAt   DateTime? @map("fcm_token_updated_at") @db.Timestamptz
  appVersion          String?   @map("app_version") @db.VarChar(32)
  @@index([fcmToken], name: "idx_mobile_sessions_fcm_token")
}

model Notification {
  communityId String? @map("community_id") @db.Uuid   // was required; null for ticket/service events
  // optional deep-link payload for the app, e.g. { "type": "ticket", "id": "..." }
  data        Json?
}
```

Also add a unique-on-token rule in code: when a token is saved on one session, clear it from any other session row that has the same token (a phone can only belong to one logged-in user).

User preferences: reuse `User.postNotificationsEnabled` for posts and recommendations. Add `pushEnabled Boolean @default(true)` on `User` as a master mute for all pushes. Per-category settings are a later step.

## 6. API

All endpoints below require the normal mobile session, like every other mobile call.

| Endpoint | Purpose |
|---|---|
| `PUT /api/v1/mobile/push-token` body `{ token, platform?, appVersion? }` | Register or refresh. Saves the token on the caller's `MobileSession` and clears it from any other session. Idempotent. |
| `DELETE /api/v1/mobile/push-token` | Remove (for example when the user turns notifications off in the OS). Logout needs no call: deleting the session removes the token. |
| `PATCH /api/v1/mobile/push-settings` body `{ pushEnabled }` | Master mute. |
| `POST /auth/mobile/login` (existing) | Add optional `fcmToken`. |

The generic guide's `POST /internal/notifications/send` is **not needed**: our services run in the same process and call a function (`enqueuePush`) directly. This avoids exposing an internal HTTP endpoint.

## 7. Sending

New files in `apps/backend/src/`:

- `lib/fcm.ts`: initialises `firebase-admin` from `FCM_SERVICE_ACCOUNT_JSON` (or a file path), exports `sendPush(token, payload)` and `sendPushMany(tokens, payload)` (`sendEachForMulticast`, max 500 per call). Without credentials it logs and no-ops, so dev and tests run unchanged.
- `lib/push.ts`: `enqueuePush({ userIds, title, body, data, collapseKey? })`. Skips users with `pushEnabled = false`. Adds a BullMQ job with `attempts: 5`, exponential backoff, `removeOnComplete`.
- `notifications.service.ts`: `sendPush(job)` handler registered in `worker.ts`. Looks up `MobileSession.fcmToken` for the users, sends, and handles errors:
  - `UNREGISTERED` (404) or `INVALID_ARGUMENT`: set `fcmToken = null`, do not retry.
  - `UNAVAILABLE`, `INTERNAL`, quota: throw so BullMQ retries.
- Cron job `PUSH_TOKEN_CLEANUP_JOB` (daily): clear tokens whose `fcmTokenUpdatedAt` is older than 90 days.

Payload shape (agree with the mobile team; the `data` keys are the contract):

```json
{ "type": "ticket|service|post|recommendation|subscription",
  "id": "<ticketId | requestId | postId | recommendationId>",
  "communityId": "<uuid or omitted>",
  "event": "message|quote|paid|invoice|closed|expiring|expired|..." }
```

Send a notification message (title and body, so the OS shows it when the app is closed) **plus** data (for navigation on tap). FCM data values must be strings.

## 8. Event map: where to hook

| Event | Recipient | Hook point | Collapse key |
|---|---|---|---|
| New community post | Community members | `NotificationsService.fanOutCommunity` (posts) | none |
| Admin replies to a ticket | Ticket owner | `AdminTicketsService.reply` | `ticket:<id>` |
| Ticket resolved | Ticket owner | `AdminTicketsService.resolve` | `ticket:<id>` |
| Admin reply in a service chat | Request owner | `AdminServicesService.reply` | `service:<id>` |
| Quote sent (new or revised) | Request owner | `AdminServicesService.sendQuote` | `service:<id>` |
| Quote expired | Request owner | `expireServiceQuotes` (cron) | `service:<id>` |
| Payment confirmed and invoice ready | Request owner | `ServicePaymentsService.afterSettle` | `service:<id>` |
| Request closed by admin | Request owner | `AdminServicesService.close` | `service:<id>` |
| Subscription expiring in 7 days, 1 day, expired | The member | `subscription-lifecycle.ts` (next to the existing `notifyOnce` calls) | none |
| Plan extended, community added | The member | the existing welcome/extended/community-added email jobs | none |

Rule for every hook: write the inbox row first (`notifyOnce` or `createAndPublishNotification`), then enqueue the push only when the row was newly created. That keeps push, inbox and email in lockstep and prevents duplicate pushes on job retries (same idea as the email rule in `notify-once.ts`).

Never push money details beyond what the member already sees in-app, and never include invoice URLs or amounts in the push body (lock-screen visibility). Keep bodies short, for example "Your quote is ready" rather than the amount.

## 9. Mobile app contract (short)

1. After login and after granting OS permission: `getToken()`, then `PUT /api/v1/mobile/push-token` (or pass `fcmToken` in the login call).
2. On `onTokenRefresh`: call `PUT` again immediately.
3. On every app launch: if the token differs from the last one sent, or more than 24 hours passed, call `PUT`.
4. On logout: nothing extra needed server-side. The app may also call `deleteToken()`.
5. On tap: read `data.type` and `data.id`, then route to the ticket, service request, post or recommendation.
6. iOS needs the APNs key in Firebase, the Push Notifications capability, Background Modes, and a real device. Foreground display needs `flutter_local_notifications`.
7. The inbox screen uses `GET /api/v1/notifications` and `/unread-count` (already existing). It is the source of truth if a push is missed.

A separate mobile developer document will be written when the backend is built.

## 10. Phases

| Phase | Scope | Notes |
|---|---|---|
| 1 (done) | Token storage: migration, `PUT/DELETE push-token`, `fcmToken` on login, push settings | Testable without Firebase. |
| 2 (done) | `fcm.ts`, `push.ts`, queue job, error handling, cleanup cron | Tested with a fake FCM transport. |
| 3 (done) | Hook community posts and recommendations, then tickets, then services, then subscription reminders; make `Notification.communityId` nullable and add `data` | One event group at a time. |
| 4 (done) | Mobile integration guide (`docs/mobile-push-integration.md`) | Written. |

## 11. Testing plan

- Unit: token upsert clears the same token on other sessions; `UNREGISTERED` clears the token; transient errors retry; `pushEnabled = false` sends nothing; a retried job does not duplicate the inbox row or the push.
- Integration with real Postgres and Redis and a fake FCM transport (same approach as the fake Razorpay server).
- Logout and re-login on a second phone: the old token receives nothing.
- Not testable here: a real device receiving a real push. That needs a staging check with a Firebase project and a physical Android and iPhone.

## 12. Deployment checklist

- [ ] Create the Firebase project; add Android and iOS apps.
- [ ] Upload the APNs auth key (.p8) in Firebase (iOS).
- [ ] Put the service account JSON on the server as `FCM_SERVICE_ACCOUNT_JSON` (secret; never in the app or the repo).
- [ ] Run the migration.
- [ ] Run the worker and cron processes (already required by other features).

## 13. Risks and open items

- **Single device**: if you later allow several simultaneous logins, switch to a separate `devices` table as in the generic guide. Moving from "token on session" to "devices table" is a contained change.
- **Pushes are best effort**: iOS especially may drop or delay. The inbox covers it. Critical messages (OTP, payments) keep using email and WhatsApp.
- **Volume**: a post to a large community enqueues one push job per chunk and sends up to 500 tokens per FCM call. Fine at current scale; revisit with FCM topics if a community grows to tens of thousands.
- **Quiet hours and per-category mute** are not in v1.

## 14. Update: inbox rows are per event, not per thread

Decision (2026-10-21): every ticket or service event gets its own inbox row, so the inbox keeps full history. Each row's `source_id` is the id of the event (message id, quote id, invoice id, system message id; the ticket id or request id for the terminal events "resolved" and "closed"), which keeps the existing unique key `(user_id, type, source_id)` meaningful: retrying the same event never creates a second row or a second push. Push banners still replace the previous one for the same thread (`collapseKey`).

All member notifications also travel on one live socket, `/ws/notifications`, which accepts both the web and the mobile login (see `docs/mobile-push-integration.md`, section 7b).
