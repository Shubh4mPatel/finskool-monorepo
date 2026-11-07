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
       fan-out job)                 │   post)                       ├─ (no admin digests)
                                    ├─ email jobs                   ├─ service-quote expiry
 LiveNotificationsFeed              └─ push job → FCM               └─ stale push-token + old-inbox cleanup
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
- import-complete uses a fresh `randomUUID()` so it never collides.

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
| `community-added` | First paid access to a community (payment, or admin adds the community to a member) | The member | ✅ | ✅ | ✅ (receipt PDF attached when paid online) | ✅ |
| `subscription-extended` | Renewal (member payment, or admin extends) | The member | ✅ | ✅ | ✅ (receipt PDF attached when paid online) | ✅ |
| `subscription-expiring-7-days` | Daily reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-expiring-1-day` | Daily reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `subscription-expired` | Expiry job or reminder sweep | The member | ✅ | ✅ | ✅ | ✅ |
| `ticket-update` | Admin replies to or resolves a support ticket | The ticket owner | ✅ | ✅ | ➖ | ✅ |
| `service-update` | Admin message / quote / close, payment received, quote expiry on a service request | The request owner | ✅ | ✅ | ➖ (invoice email on payment, see 4.3) | ✅ |

### 4.2 Admin-facing events

None of these send a push; admins get the inbox row and the live event (the web bell). Tapping one opens the page in the last column.

| `type` | Trigger | Recipients | Email | Opens |
|---|---|---|---|---|
| `admin-new-ticket` | A member opens a ticket | Super admins + admins of the ticket's community (only they can open it) | ➖ | `/admin/tickets/<id>` |
| `admin-ticket-reply` | A member sends a message on a ticket **nobody has claimed yet** | Same as above | ➖ | `/admin/tickets/<id>` |
| `admin-new-service-request` | A member requests a service | **Every admin** (services are global) | ➖ | `/admin/services/<id>` |
| `admin-service-message` | A member sends a message on a request **nobody has claimed yet** | Every admin | ➖ | `/admin/services/<id>` |
| `admin-subscription-paid` | A member buys or renews a plan (`PaymentsService.settlePlanOrder`: the app's verify, web checkout and the Razorpay webhook all end there, once per grant). Not sent when an admin adds or extends a member. | Super admins + admins of the plan's community | ✅ (`admin-payment`) | `/admin/members/<id>` |
| `admin-service-paid` | A member pays a quote (verify or webhook) | Every admin | ✅ (`admin-payment`) | `/admin/services/<id>` |
| `admin-payment-flagged` | A payment could not be applied (amount mismatch, quote replaced, no invoice) | Every admin | ✅ (`admin-payment`, "needs review") | `/admin/payment-flags?request=<id>` |
| `new-member-registered` | A member finishes mobile registration (a member added by an admin who registers on the web still notifies the admin who added them) | Super admins + admins of a community the member is in (the free community for new sign-ups), because only they can open the profile | ✅ (web path only: `admin-new-member`) | `/admin/members/<id>` |
| `import-complete` | Bulk member import finished | The admin who ran the import | ➖ | `/admin/import-csv` |

**Payment emails to admins.** The three payment types above are sent by `notifyAdminsOfPayment` (`lib/admin-payment-notify.ts`): the inbox row and live event first (`notifyAdmins`), then one `admin-payment-email` job per admin **who was just told**. `notifyAdmins` returns those admins, so the same payment seen twice (verify and webhook) adds no second row and no second email. An admin with no email address gets the inbox row only. A failure to queue an email is logged and never fails the payment or removes the inbox row.

"Claimed" means the ticket / request has an assigned admin. That admin is already in the chat and sees the live message there, so a claimed chat does not notify anyone again.

Removed (decided 2026-11-03): `new-member-reply` (a member starts a thread or replies to an admin's comment), `admin-unreplied-digest` (daily 09:30) and `admin-expiry-report` (Mondays 10:00). Their producers, cron schedulers and email templates are gone; `cron.ts` removes the two old schedulers from Redis on start. Old rows of these types can still exist in inboxes.

### 4.3 Email-only events (no inbox row, no push)

Sent through `notificationsQueue` email jobs. Subject lines come from `lib/email-templates.ts`.

| Job | Subject | Trigger |
|---|---|---|
| `welcome-email` | Set up your Finskool21 account | Admin adds or imports a member |
| `member-reinstated-email` | Your Finskool21 access has been restored | Admin revives a member, or reinstates a suspended one |
| `member-suspended-email` | Your Finskool21 access has been suspended | Admin suspends a member |
| `community-access-removed-email` | Your {community} access has been removed | Admin removes a community from a member |
| `service-invoice-email` | Payment received - invoice {number} | Service request paid; GST invoice PDF is rendered and attached |
| `admin-payment-email` | `{member} paid {amount}` (or `Payment needs review: {member} paid {amount}`) | To admins: a member bought or renewed a plan, paid a service quote, or paid and the payment needs review. Template `admin-payment`. See 4.2. |
| `otp-whatsapp` | (WhatsApp message) | Mobile registration OTP. Falls back to the `otp-email` job only on the final attempt, and only if `WHATSAPP_EMAIL_FALLBACK_ENABLED`. |
| `otp-email` | Your Finskool21 verification code is {code} | Fallback for the above |
| `password-reset-otp-email` | Your Finskool21 password reset code is {code} | Mobile forgot-password |
| `mobile-new-login-email` | New login to your Finskool21 account | Every mobile login |

**Plan purchase receipts.** When a member pays for a plan, `settlePlanOrder` issues one `plan_receipts` row (number `RCPT/2026-27/0001`, its own counter), renders the PDF into the invoices bucket in the background, and attaches the same PDF to the "added" / "extended" email above. The member lists and downloads receipts in the app: `GET /api/v1/payments/receipts` and `GET /api/v1/payments/receipts/{id}/download` (see `docs/mobile-payment-receipts.md`). It is a payment receipt, not a GST tax invoice: plan prices carry no tax split.

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
| `new-member-registered` (mobile) | `{member} has registered` | `New member joined with {phone}.` | `{type:'member', id:userId}` |
| `new-member-registered` (web, added by an admin) | `{member} has registered` | `Joined {community} on {date}.` | `{type:'member', id:userId, communityId}` |
| `admin-new-ticket` | `New support ticket` | `{member} opened "{subject}" in {community}.` | `{type:'ticket', id:ticketId, communityId, event:'new'}` |
| `admin-ticket-reply` | `New message on {subject}` | `{member}: {preview}` | `{... event:'reply'}` |
| `admin-new-service-request` | `New service request` | `{member} requested {service title}.` | `{type:'service', id:requestId, event:'new'}` |
| `admin-service-message` | `New message on {service title}` | `{member}: {preview}` | `{... event:'message'}` |
| `admin-subscription-paid` | `New subscription` (or `Subscription renewed`) | `{member} bought {plan} in {community} for {amount}.` (or `renewed`) | `{type:'member', id:userId, communityId, event:'paid'}` |
| `admin-service-paid` | `Quote paid` | `{member} paid {amount} for {service} (SR-n).` | `{... event:'paid'}` |
| `admin-payment-flagged` | `Payment needs review` | `{member}'s {amount} payment for SR-n could not be applied. Refund it or resolve it.` | `{type:'payment-flags', id:requestId, event:'flagged'}` |
| `import-complete` | `Import complete — {n} members added` | `{n} rows skipped. Review the error list.` | `{type:'members', id:communityId, communityId}` |

---

## 5. Routing data (`data`)

`lib/notification-routing.ts`. The same object is stored on the row, returned by the REST list and the live socket, and sent as the FCM `data`. All values are strings (FCM requires it).

```
{ type: <module>, id: <entity id>, communityId?: <community>, event?: <what happened> }
```

| `type` | `id` is | Used by |
|---|---|---|
| `feed` | post id | Anything belonging to the **free community**. The free community's content is the general feed, which is not scoped to a community, so `type` becomes `feed` and `communityId` is omitted. |
| `post` | post id | post, reaction (and older `thread` / `new-member-reply` rows) |
| `recommendation` | recommendation id | older rows only (no longer sent) |
| `subscription` | community id | membership events; `event` is `community-added`, `extended`, `expiring-7`, `expiring-1`, `expired` |
| `ticket` | ticket id | ticket-update (`event` is `reply`, `resolved`); admin-new-ticket / admin-ticket-reply (`new`, `reply`) |
| `service` | request id | service-update; `event` is `reply`, `quote`, `paid`, `closed`, `quote-expired` |
| `member` | user id | new-member-registered, admin-subscription-paid (admin member profile) |
| `members` | community id | import-complete |
| `payment-flags` | service request id | admin-payment-flagged: the admin page listing flagged payments (`/admin/payment-flags`) |
| `threads`, `subscriptions` | community id | older digest rows only (no longer sent) |

Reaction and reply rows written before `data` existed have `data = null`. `GET /notifications` fills the gap on read: it looks up the reaction's / comment's post and builds post routing (a reaction or comment whose post was deleted keeps `data: null`).

---

## 6. Channels in detail

### 6.1 Inbox REST API

Mounted at `/api/v1/notifications`. Uses `authenticate`, so it accepts both the web JWT and the mobile session cookie, for any role. No role gate.

| Method and path | Behaviour |
|---|---|
| `GET /` | Query `pageSize` (default 20, max 50), `communityId` (optional UUID), and either `cursor` (the app: pages by "older than this item", ordered `createdAt desc, id desc`, no totals) or `page` (default 1, the website: page numbers with totals). Response `{ success, data: { notifications, pageSize, nextCursor, total?, page?, totalPages? } }`; `nextCursor` is returned in both modes and is `null` on the last page. Bad cursor: 400 `INVALID_CURSOR`. `notifications.created_at` is millisecond precision and indexed `(user_id, created_at desc, id desc)` for this. |
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

Described in 4.3 and in the "Email" column above. Always from a worker job, except the reminder/expiry emails, which cron sends inline. A failed email never rolls back the inbox row.

**Logo.** The Finskool logo (`email-template/logo.png`) is attached inside every email as an inline image (`cid:finskool-logo`, added in `lib/mailer.ts`), so it shows without depending on the website or `EMAIL_LOGO_URL`. Set `EMAIL_LOGO_INLINE=false` to link to `EMAIL_LOGO_URL` instead. Push banners use the app icon; Android also gets the `ic_notification` icon name and brand colour from the server (the drawable lives in the app).

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

1. A producer calls `enqueuePush({ userIds, title, body, data, threadId? })` (`lib/push.ts`). It adds a `push-notification` job to the `notifications` queue: **5 attempts, exponential backoff from 5 s**, `removeOnFail` keeps the last 500. It never throws: a Redis problem is logged and the triggering request still succeeds. **A push is never lost to a queue failure:** a notification row that wants a push is saved with `push_pending = true`, and `queuePushFor` clears the flag once the job is queued. If queueing fails (or the process dies in between), the row stays pending and the **`push-retry` job (every 2 minutes, cron)** queues it. It waits 60 seconds before touching a row, groups the rows of one announcement into jobs of up to 500 members, and gives up after 24 hours (a push that late is useless). Backed by the partial index `idx_notifications_push_pending`. If the job is queued but clearing the flag fails, the retry may queue it a second time (a duplicate push is preferred to a lost one).
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
| Post fan-out | `queuePushFor` per 500-recipient chunk |
| Payment settlement, admin extend, admin adds community | `queuePushFor` after the row is written |
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
| 02:00 daily | `expire-subscriptions` | Every active subscription with `validUntil < today` gets its member told (`subscription-expired`: inbox, live, email, push) and is then set inactive. No grace period. Each subscription is handled on its own: if telling a member fails, that subscription stays open and is retried tomorrow, and the other members are not affected. Nobody is told twice on a retry. Suspended and deleted members are closed but not told. The run reports `{ expired, failed }`. |
| 03:00 daily | `ticket-upload-cleanup` | Orphan ticket uploads. Not a notification. |
| 03:30 daily | `push-token-cleanup` | Clears device tokens older than 90 days. |
| 03:45 daily | `notification-cleanup` | Deletes notifications that are **read** and older than **90 days** (`createdAt`), in slices of 5,000 (at most 200 slices a run; the rest waits for the next day). Unread notifications are never deleted. Backed by the partial index `idx_notifications_read_created`. Safe for the send-once rules, which key on events that are long over by then. |
| every 2 min | `push-retry` | Queues pushes whose first attempt failed to queue (rows still `push_pending`). See section 8. |
| 09:00 daily | `subscription-lifecycle-sweep` | Reminders (below). |
| 09:30 daily | 10:00 Mondays | every 15 min | `service-quote-expiry` | Expires lapsed service quotes and sends `service-update` / `quote-expired`. |
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
| `createAndPublishNotification` | Creates the row, publishes the live event, optionally enqueues a push. Throws if the row can't be written. Used by import-complete (fresh `sourceId`). |
| `notifyOnce` | Same, but swallows the unique-key violation (Prisma `P2002`) and returns `null` if the row already existed. Callers send the paired email only when the result is non-null. Used by the subscription lifecycle. |
| `notifyMemberThread` | For ticket / service activity. Creates a row per event (`sourceId = eventId`), publishes live, enqueues a push with `threadId`. Never throws: it must not fail the admin action that caused it. |
| `notifyAdmins` | For member activity the admins should see (`lib/admin-notify.ts`). One row per admin per event (`sourceId = eventId`, repeat of the same event adds nothing) plus a live event. No push (admins use the web). Never throws. |
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
