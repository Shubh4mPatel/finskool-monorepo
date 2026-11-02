# Notifications: events and logic

How notifications work in the backend: every event that creates one, who receives it, which channels carry it (inbox, live socket, email, push), and the rules around delivery.

> Source of truth: this document was written by reading the code in `apps/backend/src` only. File references point at the code, so if something here drifts, the code wins.

---

## 1. The four channels

Every notification is some combination of these:

| Channel | What it is | Stored? |
|---|---|---|
| **Inbox** | A row in the `notifications` table. Read through the REST API. | Yes |
| **Live socket** | WebSocket `/ws/notifications`. Tells an open app/tab that a new row exists. | No (fire and forget) |
| **Email** | Sent through SMTP from a BullMQ job. | No |
| **Push** | FCM message to the member's phone. Mobile only. | No |

The inbox row is the record. The other three are nudges on top of it. For the events that have a row, the row is always written **before** anything else is attempted.

---

## 2. Architecture

Three separate processes take part:

```
 API process (index.ts)            worker.ts                      cron.ts
 ─────────────────────             ──────────                     ───────
 request handlers                  BullMQ Worker on the           BullMQ schedulers + Worker on
  ├─ write Notification row         "notifications" queue          the "digest" queue
  ├─ redis.publish (live)           (concurrency 5)                 ├─ subscription reminders
  └─ queue.add(email / push /       ├─ fan-out jobs (post,          ├─ expiry sweep
       fan-out job)                 │   post)                       ├─ admin digests
                                    ├─ email jobs                   ├─ service-quote expiry
 LiveNotificationsFeed              └─ push job → FCM               └─ stale push-token cleanup
  subscribes to Redis
  "notifications:live" and
  forwards to open sockets
```

- **Redis pub/sub channel** `notifications:live` carries a `LiveNotificationEvent` (`userId, type, communityId, message, sourceId, postId?`). The worker and cron processes have no access to the API process's WebSocket connections, so they publish to Redis and `lib/live-notifications-feed.ts` (running in the API process) forwards it.
- **Queue** `notifications` (BullMQ) holds fan-out, email and push jobs. Queue `digest` is separate and is produced and consumed only by `cron.ts`.
- Job names and payload types live in `lib/queue.ts`.

### Code map

| Concern | File |
|---|---|
| REST inbox (routes, controller, service) | `modules/notifications/*` |
| Type names, inbox item shape | `modules/notifications/notifications.dto.ts` |
| Routing payload (`data`) | `lib/notification-routing.ts` |
| "Create once" helpers | `lib/notify-once.ts` |
| Ticket / service activity helper | `lib/member-notify.ts` |
| Queue, job names, payload types | `lib/queue.ts` |
| Worker (notifications queue) | `worker.ts` |
| Cron (digest queue, schedules) | `cron.ts` |
| Live socket | `lib/live-notifications-feed.ts` |
| Push enqueue | `lib/push.ts` |
| FCM sending | `lib/fcm.ts` |
| Push device token and settings API | `modules/push/*` |
| Email templates | `lib/email-templates.ts` |

---

## 3. Data model

### `notifications` table

| Column | Notes |
|---|---|
| `id` | UUID |
| `communityId` | Nullable. `null` for service requests, which belong to no community. |
| `userId` | The recipient. |
| `type` | One of the type strings in section 4. |
| `sourceId` | The entity the notification is about (post id, subscription id, comment id, message id, ...). |
| `title`, `message` | The text shown to the user. |
| `data` | JSON routing payload (section 5). Nullable on old rows. |
| `isRead`, `createdAt`, `updatedAt` | |

**Unique key `(userId, type, sourceId)`** (`uq_notifications_user_type_source`). This is the idempotency mechanism: the same event reported twice cannot create two rows. Each producer picks a `sourceId` that identifies "this exact event":

- subscription events use the subscription id,
- post uses the post id,
- ticket/service updates use the message id / quote id / invoice id (or the ticket / request id for terminal events),
- digests and import-complete use a fresh `randomUUID()` so they never collide.

### Other fields that affect delivery

| Field | Effect |
|---|---|
| `User.postNotificationsEnabled` (default `true`) | If `false`, the member gets **nothing** for new posts: no row, no email, no push, no live event. Section 7. |
| `User.pushEnabled` (default `true`) | If `false`, no pushes. Inbox, socket and email are unaffected. |
| `MobileSession.fcmToken` | The device token. One mobile session per user, so one token per user. |

---

## 4. Event catalogue

Notification `type` values (from `NotificationType`) with what triggers them, who gets them, and what channels they use.

Legend: ✅ sent, ➖ not sent.

### 4.1 Member-facing events

| `type` | Trigger | Recipient | Inbox | Live | Email | Push |
|---|---|---|---|---|---|---|
| `post` | Admin publishes a post (`PostsService.publishPost`) | Community fan-out (section 4.4) | ✅ | ✅ | ✅ | ✅ |
| `reaction` | Someone reacts to a post | The post's author (not if self-reaction) | ✅ | ✅ | ➖ | ➖ |
| `community-added` | First paid access to a community (payment, or admin adds the community to a member) | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-extended` | Renewal (member payment, or admin extends) | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-expiring-7-days` | Daily reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-expiring-1-day` | Daily reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-expired` | Expiry job or reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `ticket-update` | Admin replies to or resolves a support ticket | The ticket owner | ✅ | ✅ | ➖ | ✅ |
| `service-update` | Admin message / quote / close, payment received, quote expiry on a service request | The request owner | ✅ | ✅ | ➖ (invoice email on payment, see 4.3) | ✅ |

### 4.2 Admin-facing events

None of these send a push.

| `type` | Trigger | Recipient | Inbox | Live | Email |
|---|---|---|---|---|---|
| `new-member-reply` | A non-admin starts a thread, or replies to an admin's comment | Every admin of that community (super admins plus admins granted that community) | ✅ | ✅ | ➖ |
| `new-member-registered` | A member who was added by an admin completes web registration | The admin who added them (`ApprovedPhone.addedBy`), once per community where the member has an active subscription | ✅ | ✅ | ✅ (`admin-new-member`) |
| `import-complete` | Bulk member import finished | The admin who ran the import | ✅ | ✅ | ➖ |
| `admin-unreplied-digest` | Daily 09:30 IST | Each admin who has unreplied member threads in communities they can access | ✅ | ✅ | ✅ |
| `admin-expiry-report` | Mondays 10:00 IST | Each admin with subscriptions expiring in the next 7 days in their communities | ✅ | ✅ | ✅ |

### 4.3 Email-only events (no inbox row, no push)

Sent through `notificationsQueue` email jobs. Subject lines come from `lib/email-templates.ts`.

| Job | Subject | Trigger |
|---|---|---|
| `welcome-email` | Set up your Finskool21 account | Admin adds or imports a member |
| `member-reinstated-email` | Your Finskool21 access has been restored | Admin revives a member, or reinstates a suspended one |
| `member-suspended-email` | Your Finskool21 access has been suspended | Admin suspends a member |
| `community-access-removed-email` | Your {community} access has been removed | Admin removes a community from a member |
| `service-invoice-email` | Payment received - invoice {number} | Service request paid; GST invoice PDF is rendered and attached |
| `otp-whatsapp` | (WhatsApp message) | Mobile registration OTP. Falls back to the `otp-email` job only on the final attempt, and only if `WHATSAPP_EMAIL_FALLBACK_ENABLED`. |
| `otp-email` | Your Finskool21 verification code is {code} | Fallback for the above |
| `password-reset-otp-email` | Your Finskool21 password reset code is {code} | Mobile forgot-password |
| `mobile-new-login-email` | New login to your Finskool21 account | Every mobile login |

### 4.4 How community fan-out works (`post`)

> New recommendations and replies to a member's comment **no longer notify** (decided 2026-11-02): no inbox row, push or email. Their producers, the fan-out job, the `thread-reply` email job and its template were removed. Older `recommendation` and `thread` rows can still exist in inboxes.

`NotificationsService.fanOutCommunity`, run in the worker:

1. **Recipients**: subscriptions in the community with `isActive = true` and `validUntil >= start of today` **and an account that is `active` and not deleted**, de-duplicated per user, then filtered to drop the user who triggered it and anyone with `postNotificationsEnabled = false`. Suspended and deleted members get nothing.
2. Recipients are processed in **chunks of 500**. For each chunk:
   - `notification.createManyAndReturn(..., skipDuplicates: true)` writes the rows and returns exactly which ones it created.
   - Only for those members, in parallel: send emails (skipping members with no email), publish a live event per user, and, if `push` is on, enqueue one push job. A member who already has this notification (a retried job, or the same post announced before) gets nothing again.
3. Email failures are logged and swallowed (`Promise.allSettled`) so an SMTP problem never fails the job.

**Triggering and retries**
- Post: queued on publish with `jobId: post-published-{postId}`, 5 attempts, exponential backoff from 5 s. Publishing the same post twice is impossible ("already published" error), and the fixed `jobId` stops duplicate jobs.

**Content**

| | `post` |
|---|---|
| title | `New announcement in {community name}` (the email subject) |
| message | `New post: "{post title}"` |
| email | `new-announcement` template |

### 4.5 Exact texts for every event with a row

`{date}` is formatted by `formatEmailDate`.

| `type` | `title` | `message` | `data` |
|---|---|---|---|
| `post` | `New announcement in {community}` | `New post: "{title}"` | `{type:'post', id:postId, communityId}` (free community: `{type:'feed', id:postId}`) |
| `reaction` | `New reaction on your post` | `{reactor} reacted to your post "{post title}"` | post routing |
| `new-member-reply` | `New thread on {post title}` | `{member} asked a question in {community}.` | post routing |
| `community-added` (payment) | `You've been added to {community}` | `You're active until {date}.` | `{type:'subscription', id:communityId, communityId, event:'community-added'}` |
| `community-added` (admin) | `You've been added to {community}` | `Active until {date}.` | same |
| `subscription-extended` | `Access extended` | `You're active until {date}.` | `{... event:'extended'}` |
| `subscription-expiring-7-days` | `Access ends in 7 days` | `Your {community} subscription expires on {date}. Email support@finskool21.com to extend.` | `{... event:'expiring-7'}` |
| `subscription-expiring-1-day` | `Last day of access` | `Your {community} subscription ends tomorrow. Email support@finskool21.com to extend.` | `{... event:'expiring-1'}` |
| `subscription-expired` | `Access paused` | `Email support@finskool21.com to restore your {community} access.` | `{... event:'expired'}` |
| `ticket-update` / reply | `Support replied to your ticket` | First ~100 chars of the message, or `Sent you an attachment`, or `New message` | `{type:'ticket', id:ticketId, event:'reply', communityId}` |
| `ticket-update` / resolved | `Your ticket was resolved` | `Tap to see the outcome and rate the support you got.` | `{... event:'resolved'}` |
| `service-update` / reply | `New message about your service request` | Message preview (as above) | `{type:'service', id:requestId, event:'reply'}` |
| `service-update` / quote | `Your quote is ready` (or `Your quote was updated` when it replaces an earlier quote) | `Open your service request to review it and pay.` | `{... event:'quote'}` |
| `service-update` / paid | `Payment received` | `Thank you. Your GST invoice is ready in your service request.` | `{... event:'paid'}` |
| `service-update` / closed | `Your service is complete` (closed as completed) or `Your service request was closed` | `Tap to see the details and rate it.` or `Tap to see why.` | `{... event:'closed'}` |
| `service-update` / quote-expired | `Your quote expired` | `Ask for a new quote in your service request chat.` | `{... event:'quote-expired'}` |
| `new-member-registered` | `{member} has registered` | `Joined {community} on {date}.` | `{type:'member', id:userId, communityId}` |
| `import-complete` | `Import complete — {n} members added` | `{n} rows skipped. Review the error list.` | `{type:'members', id:communityId, communityId}` |
| `admin-unreplied-digest` | `{n} threads waiting for a reply` | `Oldest is {d} days old in {community}.` | `{type:'threads', id:communityId, communityId}` |
| `admin-expiry-report` | `{n} subscriptions expiring this week` | `Review and extend before {date}` | `{type:'subscriptions', id:communityId, communityId}` |

---

## 5. Routing data (`data`)

`lib/notification-routing.ts`. The same object is stored on the row, returned by the REST list and the live socket, and sent as the FCM `data`. All values are strings (FCM requires it).

```
{ type: <module>, id: <entity id>, communityId?: <community>, event?: <what happened> }
```

| `type` | `id` is | Used by |
|---|---|---|
| `feed` | post id | Anything belonging to the **free community**. The free community's content is the general feed, which is not scoped to a community, so `type` becomes `feed` and `communityId` is omitted. |
| `post` | post id | post, reaction, new-member-reply (and older `thread` rows) |
| `recommendation` | recommendation id | older rows only (no longer sent) |
| `subscription` | community id | membership events; `event` is `community-added`, `extended`, `expiring-7`, `expiring-1`, `expired` |
| `ticket` | ticket id | ticket-update; `event` is `reply`, `resolved` |
| `service` | request id | service-update; `event` is `reply`, `quote`, `paid`, `closed`, `quote-expired` |
| `member` | user id | new-member-registered |
| `members` | community id | import-complete |
| `threads` | community id | admin-unreplied-digest |
| `subscriptions` | community id | admin-expiry-report |

Reaction and reply rows written before `data` existed have `data = null`. `GET /notifications` fills the gap on read: it looks up the reaction's / comment's post and builds post routing (a reaction or comment whose post was deleted keeps `data: null`).

---

## 6. Channels in detail

### 6.1 Inbox REST API

Mounted at `/api/v1/notifications`. Uses `authenticate`, so it accepts both the web JWT and the mobile session cookie, for any role. No role gate.

| Method and path | Behaviour |
|---|---|
| `GET /` | Query `page` (default 1), `pageSize` (default 20, max 50), `communityId` (optional UUID). Newest first by `createdAt`. Response `{ success, data: { notifications, total, page, pageSize, totalPages } }`. |
| `GET /unread-count` | `{ success, data: { count } }`. Counts all of the user's unread rows, regardless of community. |
| `PATCH /:id/read` | Marks one read. 404 `Notification not found` if it is not the caller's; 422 `Validation failed` (`errors.id`) if the id is not a UUID. |
| `PATCH /mark-all-read` | Marks all read. `{ success, data: { count } }`. |

Item shape: `id, communityId, type, title, message, data, isRead, createdAt, updatedAt`.

### 6.2 Live socket (`/ws/notifications`)

Defined in `lib/live-notifications-feed.ts`, attached to the HTTP server in `index.ts`.

- **Auth at upgrade**: `access_token` cookie (web) or `mobile_session_id` cookie (mobile). Neither valid → `401` and the connection is destroyed. A web token wins if both are present.
- **Web clients** receive the raw `LiveNotificationEvent` JSON.
- **Mobile clients** receive `{ "event": "notification.created", "notification": <inbox item>, "unreadCount": <n> }`. Before each push the server re-validates the mobile session; if it is gone the socket is closed with code **4401** (`reauthenticate`). Pushes to one socket are chained so they stay in order.
- **Only events that have an inbox row reach mobile.** The server looks the row up by `(userId, type, sourceId)` and sends nothing if it is missing. Pure signals such as `thread-resolved` (published to admins when an admin reply auto-resolves a pending thread) therefore reach web clients only.
- **Heartbeat**: the server pings every 30 s and terminates sockets that did not answer the previous ping.
- Events are not queued. A client that was offline misses them and must re-fetch the inbox.

### 6.3 Email

Described in 4.3 and in the "Email" column above. Always from a worker job, except the two admin digests and the reminder/expiry emails, which cron sends inline. A failed email never rolls back the inbox row.

### 6.4 Push (FCM)

See section 8 for the full pipeline and `docs/mobile-push-notifications-integration.md` for what the mobile app must do.

---

## 7. Preferences and who is skipped

| Setting | Where it is changed | What it controls |
|---|---|---|
| `postNotificationsEnabled` | `PATCH /api/v1/auth/me/notifications` with `{ postNotificationsEnabled }` (works for mobile and web). Also returned in mobile login and `GET /api/v1/auth/mobile/me`. | Fan-out events only (`post`, `recommendation`). When off, the member is excluded before anything is written, so those events **never appear in their inbox**, even after turning it back on. All other events are unaffected. |
| `pushEnabled` | `GET/PATCH /api/v1/mobile/push-settings` (mobile only) | Master switch for every push. Inbox, socket and email are unaffected. |

A push is skipped for a recipient when any of these is true: `pushEnabled = false`, no registered `fcmToken`, user not `active`, user deleted.

---

## 8. Push pipeline

1. A producer calls `enqueuePush({ userIds, title, body, data, threadId? })` (`lib/push.ts`). It adds a `push-notification` job to the `notifications` queue: **5 attempts, exponential backoff from 5 s**, `removeOnFail` keeps the last 500. It never throws: a Redis problem is logged and the triggering request still succeeds.
2. The worker runs `NotificationsService.sendPush`:
   - Looks up `MobileSession` rows for the user ids with a token, for users that are `pushEnabled`, `active` and not deleted. Everyone else counts as `skipped`.
   - If FCM credentials are not configured, it logs a warning and sends nothing.
   - Sends in batches of 500 using `sendEach`, then sorts each result:
     - **invalid token** (`registration-token-not-registered`, `invalid-registration-token`, or `invalid-argument` **only when Firebase's message mentions the registration token**): the token is cleared from the session and never retried. Firebase also returns `invalid-argument` for a bad *message* (too big, reserved data key, wrong type), so those keep the token.
     - **transient** (`server-unavailable`, `internal-error`, rate-limit codes, `unknown-error`): that user is kept for retry.
     - **other failure** (including `invalid-argument` about the message): not retried, token kept. Logged **once per batch** (not per member) as `Firebase rejected the message itself, so the device tokens were KEPT`, with Firebase's message, the number of failed sends, the push type and event, the title and body lengths and the data keys, so the bad message can be found and fixed.
   - If any transient failures exist, it rewrites the job's `userIds` to only those users and throws, so BullMQ's retry never re-sends to someone who already got it.
3. **Message shape** (`toFirebaseMessage`):
   - `notification: { title, body }`
   - `data`: the routing data
   - Android: `priority: 'high'`
   - iOS (APNs): `apns-priority: 10`, `sound: 'default'`, and `thread-id` when `threadId` is set. Ticket and service pushes use `ticket:{id}` / `service:{id}` so their banners group per conversation.
   - Not set: Android notification channel id, badge count, image, click action, or a notification id.

**Who pushes**

| Producer | Pushes through |
|---|---|
| Post fan-out | `enqueuePush` per 500-recipient chunk |
| Payment settlement, admin extend, admin adds community | `enqueuePush` directly after the row is written |
| Reminder sweep and expiry job | `notifyOnce({ push })` |
| Ticket and service activity | `notifyMemberThread` |

### 8.1 Device token lifecycle (`modules/push`)

- Stored on the user's single `MobileSession` (`fcmToken`, `fcmTokenUpdatedAt`, `appVersion`).
- Set by mobile login (optional `fcmToken` in the body) or `PUT /api/v1/mobile/push-token`. A phone belongs to one logged-in member: registering a token first clears that same token from any other user's session. This is enforced by a unique index on `fcm_token` (NULLs allowed), and registrations of the same token take turns (a Postgres advisory lock), so two members can never hold the same token, even if they register at the same instant.
- A new login replaces the session, so the previous token is dropped unless the new login brings its own.
- Cleared by: `DELETE /mobile/push-token`, logout (the session row is deleted), FCM reporting the token dead, or the cleanup job (below).
- **Daily 03:30 IST cleanup** clears tokens whose `fcmTokenUpdatedAt` is older than **90 days**. The app is expected to re-register on every launch.

---

## 9. Scheduled jobs (`cron.ts`, all IST)

| Schedule | Job | Effect |
|---|---|---|
| 02:00 daily | `expire-subscriptions` | Every active subscription with `validUntil < today` is set inactive and the member gets `subscription-expired` (inbox, live, email, push). No grace period. |
| 03:00 daily | `ticket-upload-cleanup` | Orphan ticket uploads. Not a notification. |
| 03:30 daily | `push-token-cleanup` | Clears device tokens older than 90 days. |
| 09:00 daily | `subscription-lifecycle-sweep` | Reminders (below). |
| 09:30 daily | `admin-unreplied-digest` | One digest per admin. |
| 10:00 Mondays | `admin-expiry-report` | One digest per admin. |
| every 15 min | `service-quote-expiry` | Expires lapsed service quotes and sends `service-update` / `quote-expired`. |
| 15:30 Mon-Fri | `refresh-close-prices` | Stock prices. Not a notification. |

**Reminder sweep** (09:00): takes active subscriptions of active users with `validUntil` within ±7 days, and computes `days = ceil((validUntil - today) / 1 day)`:

| `days` | Bucket | `type` |
|---|---|---|
| 2 to 7 | expiring-7 | `subscription-expiring-7-days` |
| 0 to 1 | expiring-1 | `subscription-expiring-1-day` |
| -7 to -1 | expired | `subscription-expired` |

The windows (not exact days) mean a missed run is caught the next day. `notifyOnce` keys on `(userId, type, subscriptionId)`, so a member is notified once per bucket per subscription, and the email is only sent if the row was newly created. The expiry job and the sweep's `expired` bucket share the same key, so whichever reaches a subscription first sends it. Under normal operation the 02:00 expiry job always gets there first.

---

## 10. Helper functions, and when to use which

| Helper | Behaviour |
|---|---|
| `createAndPublishNotification` | Creates the row, publishes the live event, optionally enqueues a push. Throws if the row can't be written. Used by the digests (fresh `sourceId`). |
| `notifyOnce` | Same, but swallows the unique-key violation (Prisma `P2002`) and returns `null` if the row already existed. Callers send the paired email only when the result is non-null. Used by the subscription lifecycle. |
| `notifyMemberThread` | For ticket / service activity. Creates a row per event (`sourceId = eventId`), publishes live, enqueues a push with `threadId`. Never throws: it must not fail the admin action that caused it. |
| `enqueuePush` | Push only. Never throws. |

---

## 11. Configuration

| Env var | Purpose |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE` | Firebase service account. If both are empty, pushes are skipped and a warning is logged; nothing else breaks. |
| `FCM_FAKE_URL` | Testing only. Messages are POSTed to this URL instead of Firebase. Leave unset in real environments. |
| `FRONTEND_URL` | Used in email links. |
| `WHATSAPP_EMAIL_FALLBACK_ENABLED` | OTP email fallback on the final WhatsApp attempt. |
| SMTP settings | Email transport (`env.smtp`). |

---

## 12. Behaviours worth knowing

Observed in the code; some may be intentional, none are fixed by this document.

1. ~~No push for `thread`, `reaction`, `recommendation`.~~ Resolved: recommendations and comment replies no longer notify at all; `reaction` is admin-only and has no push.
2. **Members' own ticket and service messages don't create inbox rows for admins.** Admins see them through the `/ws/tickets` live events only. Only admin actions notify the member.
3. ~~Retried fan-out resends emails and live events.~~ Fixed: emails, live events and pushes go only to members whose row was really created in this run. Tested on a 1,101-member community: a full retry sends nothing, and a retry after 600 members were left undone sends to exactly those 600. Trade-off: if the worker dies in the short window after the rows are saved and before the emails go out, that group is not emailed on the retry (the inbox row is there). Before the fix that same crash gave duplicates instead.
4. **Push data has no notification id.** The push `data` is the routing object only, so an app cannot match a tapped push to an inbox row, or to a socket event, by id.
5. **Reaction rows update in place.** Changing your reaction type updates the existing row's `message`, sets `isRead = false` and bumps `updatedAt`, but the list is ordered by `createdAt`, so it does not jump to the top. Removing a reaction does not delete the row.
6. **`subscription-expiring-1-day` says "ends tomorrow" even when `days = 0`** (expires today). The bucket covers both.
7. ~~Fan-out ignores account status.~~ Fixed: the post fan-out only includes `active`, non-deleted members. The daily expiry job still closes a suspended or deleted member's subscription but no longer notifies them, and the reminder sweep also skips deleted members.
8. **Reply notifications fire for any replier**, not only admins. The email job's field is named `adminName` but carries whoever replied.
9. **Stale comment in `notifications.dto.ts`**: it says ticket/service updates are "one inbox row per ticket / service request, refreshed on every admin action". The code in `notifyMemberThread` creates **one row per event**. The code is what runs.
10. **`platform` in the push-token body is validated but not stored.** Only `token` and `appVersion` are saved.
11. **New-member-registered** is created only by the web `auth.register` flow, not by mobile registration.
12. **Only posts published through `publishPost` notify.** That is the only place the post fan-out job is queued.
