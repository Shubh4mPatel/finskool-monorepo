# Mobile push notifications: integration guide

For the mobile developer integrating push notifications, the notification inbox, and the live notification socket with the Finskool backend.

> Written from the backend code only (`apps/backend/src`). Where this guide says "the server does X", that is what the code does. Where it says "recommended", that is advice for the app, not something the server enforces. For the full list of events and rules behind them, see `docs/notifications-events-and-logic.md`.

Replace `<API>` below with the API origin, e.g. `https://api.example.com`. All REST paths start with `/api/v1`.

---

## 1. What you are building

Three things work together, and the app should use all three:

| Piece | Purpose | Works when |
|---|---|---|
| **Push (FCM)** | Banner on the lock screen, wakes the user. | App in background or killed. |
| **Live socket** `/ws/notifications` | Updates the inbox list and badge instantly. | App in foreground. |
| **Inbox REST API** `/api/v1/notifications` | Source of truth: history, unread count, mark read. | Always. |

The server writes the inbox row first, then emits the socket event and queues the push. **The inbox is always complete; push and socket are nudges.**

Checklist:

- [ ] Set up Firebase Cloud Messaging on iOS and Android (section 3).
- [ ] After login, ask for notification permission and register the FCM token (section 4).
- [ ] Re-register the token on every app launch and on every token refresh.
- [ ] Handle a tapped push (cold start and background) by routing on `data` (section 6).
- [ ] Build the inbox screen on the REST API (section 7).
- [ ] Open the socket while the app is in the foreground and update the list and badge from it (section 8).
- [ ] Avoid showing the same event twice (section 9).
- [ ] Add the two settings toggles (section 5).

---

## 2. Authentication

Mobile has no JWT. Login sets an **httpOnly cookie `mobile_session_id`** and the whole credential is that cookie. Your HTTP client must keep a cookie jar and send it on every request, **including the WebSocket upgrade request**.

- Login: `POST /api/v1/auth/mobile/login`
- Logout: `POST /api/v1/auth/mobile/logout` (deletes the session on the server, which also removes the device token, so pushes to this phone stop)
- A session is **one per user**. Logging in on a second phone replaces the first phone's session. The first phone then gets `401` with code `SESSION_INVALIDATED` ("Session ended. Please log in again.") and must log in again.
- A suspended or deleted account also fails with `401`.

Error bodies are `{ "success": false, "message": "...", "code"?: "..." }`. Validation errors are `422` with `errors` per field.

The push and settings endpoints below require a **mobile** session: a web JWT is rejected with `403 MOBILE_ONLY`.

---

## 3. Firebase setup (one-off)

The backend sends through the Firebase Admin SDK with a service account.

1. The app must be registered in the **same Firebase project** as the service account configured on the server (`FCM_SERVICE_ACCOUNT_JSON` / `FCM_SERVICE_ACCOUNT_FILE`). A token minted by a different project cannot be delivered. Confirm the project with whoever owns the backend deployment.
2. **Android**: add `google-services.json`. On Android 13+ the app must request the `POST_NOTIFICATIONS` runtime permission.
3. **iOS**: add `GoogleService-Info.plist`, upload an APNs auth key to the Firebase project, and enable the Push Notifications capability and the Remote notifications background mode. Request notification permission at runtime.
4. The server sets no Android notification channel id. Android will use the default FCM channel unless your app declares a default channel (`com.google.firebase.messaging.default_notification_channel_id` in the manifest). Create a channel with importance high so banners show.

If the server has no Firebase credentials configured, it silently skips sending (it logs `FCM not configured, push skipped`). Everything else keeps working, so a missing push is not necessarily an app bug.

---

## 4. Registering the device token

The token is stored on the user's mobile session. There are two ways to give it to the server.

### 4.1 At login (optional shortcut)

`POST /api/v1/auth/mobile/login` accepts these extra fields:

```json
{
  "email": "member@example.com",
  "password": "...",
  "deviceId": "string, max 255",
  "deviceType": "ios | android",
  "fcmToken": "FCM registration token",
  "appVersion": "max 32 chars"
}
```

Only `email` and `password` are required. If `fcmToken` is sent, the first push works right after login. If it is omitted, the new session has **no token** (the previous one is dropped).

### 4.2 Register or refresh (the main path)

```
PUT <API>/api/v1/mobile/push-token
Cookie: mobile_session_id=...
Content-Type: application/json

{ "token": "<FCM token>", "platform": "ios", "appVersion": "1.4.2" }
```

| Field | Rule |
|---|---|
| `token` | Required. 20 to 512 characters, only `A-Z a-z 0-9 _ : . -`. |
| `platform` | Optional, `ios` or `android`. Validated but **not stored**. |
| `appVersion` | Optional, up to 32 characters. Stored. |

Response: `200 { "success": true, "data": null }`. It is idempotent, so call it freely.

Errors: `404 "No active mobile session"` if the caller has no mobile session, `422` for a malformed token, `401` if the session is gone.

**Behaviour you can rely on**

- A phone belongs to one logged-in member. Registering a token clears the same token from any other account's session. So if member A logged out of a phone without the app telling the server and member B logs in there, B gets the pushes and A stops.
- The server clears a token when FCM says it is dead, and a daily job clears any token **not refreshed for 90 days**.

**What the app should do**

- Call `PUT /push-token` **after every successful login**, **on every app launch** (while logged in), and **whenever the SDK reports a refreshed token** (`onTokenRefresh` / `messaging().onTokenRefresh` / `didReceiveRegistrationToken`). The 90-day cleanup assumes this.
- Ask for the OS notification permission at a sensible moment after login, then fetch and register the token. If the user denies, there is nothing to register. You can still use the inbox and socket.

### 4.3 Removing the token

`DELETE /api/v1/mobile/push-token` stops pushes to this phone without ending the session. **Logout does this automatically**, so you do not need to call it on logout.

---

## 5. Settings: two different toggles

| Toggle | API | Effect |
|---|---|---|
| **Push notifications** (`pushEnabled`) | `GET /api/v1/mobile/push-settings` returns `{ "success": true, "data": { "pushEnabled": true } }`. `PATCH` the same path with `{ "pushEnabled": false }` returns the same shape. | Master switch for **all** pushes. Inbox, socket and email are unaffected. Default `true`. |
| **Post notifications** (`postNotificationsEnabled`) | `PATCH /api/v1/auth/me/notifications` with `{ "postNotificationsEnabled": false }`. The current value is in the login response `user` and in `GET /api/v1/auth/mobile/me`. | Controls new **posts** and new **recommendations** only. When off, the member is skipped entirely for those: **no inbox row, no email, no push, no socket event**. They will not appear later if the toggle is turned back on. Default `true`. |

Show them as separate switches, and word the second one carefully (it removes items from the inbox, not just the banner).

---

## 6. What a push looks like and what to do when it is tapped

### 6.1 Message shape

Every push has an OS-visible `notification` plus a `data` map of strings:

```
notification: { title, body }
data: { type, id, communityId?, event? }      // all values are strings
```

Extra delivery settings the server sets: Android `priority: high`; iOS `apns-priority: 10` and default sound; for ticket and service pushes an iOS `thread-id` of `ticket:{id}` or `service:{id}` so banners group per conversation.

**Not included**: a notification/inbox id, a badge count, an image, or an Android channel id. Set the badge yourself from the inbox unread count.

### 6.2 Which events send a push

| Event | `title` | `body` | `data` |
|---|---|---|---|
| New post | `New announcement in {community}` | `New post: "{post title}"` | `{type:'post', id:postId, communityId}` or, in the free community, `{type:'feed', id:postId}` |
| Added to a community | `You've been added to {community}` | `You're active until {date}.` or `Active until {date}.` | `{type:'subscription', id:communityId, communityId, event:'community-added'}` |
| Access extended | `Access extended` | `You're active until {date}.` | `{type:'subscription', ..., event:'extended'}` |
| Expires in 2 to 7 days | `Access ends in 7 days` | `Your {community} subscription expires on {date}. Email support@finskool21.com to extend.` | `{..., event:'expiring-7'}` |
| Expires today or tomorrow | `Last day of access` | `Your {community} subscription ends tomorrow. Email support@finskool21.com to extend.` | `{..., event:'expiring-1'}` |
| Expired | `Access paused` | `Email support@finskool21.com to restore your {community} access.` | `{..., event:'expired'}` |
| Support replied to ticket | `Support replied to your ticket` | Message preview (up to ~100 chars), or `Sent you an attachment`, or `New message` | `{type:'ticket', id:ticketId, event:'reply', communityId}` |
| Ticket resolved | `Your ticket was resolved` | `Tap to see the outcome and rate the support you got.` | `{type:'ticket', ..., event:'resolved'}` |
| Service request message | `New message about your service request` | Message preview | `{type:'service', id:requestId, event:'reply'}` |
| Quote sent or updated | `Your quote is ready` / `Your quote was updated` | `Open your service request to review it and pay.` | `{type:'service', ..., event:'quote'}` |
| Service paid | `Payment received` | `Thank you. Your GST invoice is ready in your service request.` | `{type:'service', ..., event:'paid'}` |
| Service closed | `Your service is complete` / `Your service request was closed` | `Tap to see the details and rate it.` / `Tap to see why.` | `{type:'service', ..., event:'closed'}` |
| Quote expired | `Your quote expired` | `Ask for a new quote in your service request chat.` | `{type:'service', ..., event:'quote-expired'}` |

**No notification at all any more** (no inbox row, push or email): a new recommendation, and a reply to a member's comment. A reaction on a post is only for the post's author (an admin) and does not send a push.

Service updates have no `communityId` (service requests belong to no community). Ticket updates include it.

### 6.3 Routing on tap

Route on `data.type`; `data.id` is the entity, and `data.event` tells you which state/tab to land on. The app decides the actual screens; this is the contract the server provides.

| `type` | `id` is | Suggested destination |
|---|---|---|
| `post` | post id | Post detail (use `communityId` for community context). |
| `feed` | post id | Post detail in the general (free) feed. There is no `communityId`. |
| `recommendation` | recommendation id | Recommendation detail. Only older inbox rows carry this now; keep the route so they still open. |
| `subscription` | community id | Membership/plan screen for that community. `event` is `community-added`, `extended`, `expiring-7`, `expiring-1`, `expired`. A good place to show the renew call to action for `expiring-*` and `expired`. |
| `ticket` | ticket id | Ticket chat. `event`: `reply`, `resolved`. |
| `service` | service request id | Service request chat. `event`: `reply`, `quote`, `paid`, `closed`, `quote-expired`. |

Always handle an **unknown `type`** (the server may add more) by opening the notifications inbox. The same `data` object is on every inbox item, so a tap in the inbox and a tap on a banner should share one routing function.

**Both start states must work:**
- App killed, user taps the banner: read the launch notification (`getInitialNotification` / launch options) and route after the app and session are ready.
- App in background, user taps: use the "notification opened" callback.

If the session has ended when the user taps, send them to login, then route.

### 6.4 Foreground messages

By default an FCM notification message is not shown as a banner while the app is in the foreground on Android, and on iOS it depends on your presentation options. See section 9 for what to do.

---

## 7. Inbox REST API

Uses the same mobile cookie. Base `<API>/api/v1/notifications`.

### List

```
GET /api/v1/notifications?pageSize=20&communityId=<uuid>&cursor=<nextCursor>
```

- `pageSize` default 20, max 50; `communityId` optional filter.
- Newest first. **Page by `cursor`, not by page number.**
  1. First load: call without `cursor`. The response has `nextCursor`.
  2. To load older items, call again with `cursor=<nextCursor>` (URL-encode it). Keep doing this while `nextCursor` is not `null`; `null` means there is nothing older.
  3. Why: new notifications keep arriving at the top (every ticket message is one). With page numbers they push older items down, so page 2 repeats items you already have or skips some. A cursor means "older than the last item I have", so arrivals cannot move anything. Items that arrive while the member scrolls come through the live socket (`notification.created`) and go on top of the list yourself; do not refetch page 1 to find them.
  4. A cursor response has no `total`, `page` or `totalPages` (counting is skipped). Use `GET /unread-count` for the badge.
  5. An invalid or edited cursor returns `400` with `code: "INVALID_CURSOR"`: restart from the first page.
- The old `page=N` still works (the website uses it) and returns the totals, but the app should not use it. It also returns `nextCursor`, so a client can start with page 1 and continue by cursor.
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "communityId": "uuid or null",
        "type": "post",
        "title": "New announcement in Alpha Traders",
        "message": "New post: \"Weekly outlook\"",
        "data": { "type": "post", "id": "uuid", "communityId": "uuid" },
        "isRead": false,
        "createdAt": "2026-10-30T09:00:00.000Z",
        "updatedAt": "2026-10-30T09:00:00.000Z"
      }
    ],
    "pageSize": 20,
    "nextCursor": "MjAyNi0xMC0zMFQwOTowMDowMC4wMDBafGJmNWY…"
  }
}
```

(`nextCursor` is `null` on the last page. `total`, `page` and `totalPages` appear only when you page by number.)

`data` can be `null` on old rows that predate routing data; open the inbox item's detail by `type` if you can, or do nothing.

### Unread count (for the badge)

`GET /api/v1/notifications/unread-count` returns `{ "success": true, "data": { "count": 5 } }`. It counts every unread row for the user across all communities, even if you filter the list.

### Mark read

- `PATCH /api/v1/notifications/{id}/read` returns `{ "success": true, "message": "Notification marked as read" }`. `404` if it is not the caller's, `422` (`errors.id`) if the id is not a valid UUID.
- `PATCH /api/v1/notifications/mark-all-read` returns `{ "success": true, "data": { "count": 12 } }`.

### `type` values the member can receive

`post`, `community-added`, `subscription-extended`, `subscription-expiring-7-days`, `subscription-expiring-1-day`, `subscription-expired`, `ticket-update`, `service-update`. Treat `type` as an open set: unknown values should still render from `title` and `message`.

The `data.type` (routing) is a different field from the row's `type`. Route on `data.type`.

---

## 8. Live socket

```
wss://<API host>/ws/notifications
Cookie: mobile_session_id=<same cookie>
```

Open it while the app is in the foreground and close it when the app goes to the background.

- No valid cookie at upgrade: HTTP `401` and the connection is dropped.
- Message received for each new inbox row:

```json
{
  "event": "notification.created",
  "notification": { "id": "...", "type": "ticket-update", "title": "...", "message": "...", "data": { "type": "ticket", "id": "...", "event": "reply" }, "isRead": false, "createdAt": "...", "updatedAt": "..." },
  "unreadCount": 6
}
```

`notification` is exactly the inbox item from section 7, and `unreadCount` is the new unread total, so you can update the list and the badge without refetching.

- **Close code `4401`** (`reauthenticate`): the session ended (logged in elsewhere, suspended, logged out). Do not reconnect; send the user to login.
- The server **pings every 30 s** and drops sockets that do not answer. Standard WebSocket libraries answer pings automatically; verify yours does.
- Mobile networks drop connections silently, so reconnect with exponential backoff on any other close or error.
- **Events are not replayed.** Anything created while the socket was down is lost to the socket. After every (re)connect and every return to the foreground, **refetch** `GET /notifications` (page 1) and `unread-count`.
- Only events that have an inbox row arrive here. Treat events by `notification.id`: a row can arrive more than once (for example a reaction row is updated in place when someone changes their reaction, then re-sent with `isRead: false`). Upsert by `id` instead of appending.

(There is a separate socket `/ws/tickets` for ticket and service chat. It is not part of notifications.)

---

## 9. Avoiding double notifications

The server emits **both** a socket event and a push for the same event and does not coordinate them. It is the app's job to make sure the user sees one.

Because the push has no notification id (section 6.1), de-duplication cannot be done by id between a push and a socket event. Use app state instead. Recommended approach:

| App state | Socket | Push banner | What to do |
|---|---|---|---|
| Foreground, socket connected | Delivers the event | Would also arrive | **Suppress the OS banner** for pushes received in the foreground. Show an in-app toast or just update the list and badge from the socket event. On iOS set the foreground presentation options to none; on Android do not post a local notification from the foreground message handler. |
| Foreground, socket not connected yet | Missed | Arrives | Show it, and refetch the inbox. |
| Background / killed | Closed | OS shows the banner | Nothing to suppress. On open, refetch the inbox and badge. |

Other rules:

- **Never build local notifications from the socket**, and never create a local notification from a push the OS already showed. The OS shows the push, so a second local copy would be the duplicate.
- The inbox list is the single list of record. Merge socket events and refetched pages by `notification.id`.
- Clear the OS badge and delivered banners as appropriate when the user opens the inbox. The server does not manage the badge.
- If you need "mark this inbox row read when the user taps its push", note that the push carries only `type/id/event`. You can mark everything read on inbox open (`mark-all-read`), or ask the backend team to add a `notificationId` to the push `data`.

---

## 10. Lifecycle and edge cases

| Situation | What happens | App action |
|---|---|---|
| User logs out | Session deleted, token gone, pushes stop. | Close the socket, clear local state. |
| User logs in on another phone | Old phone's session is replaced; it gets `401 SESSION_INVALIDATED` and the socket closes with `4401`. | Show login. |
| Different account logs in on the same phone | The token moves to the new account's session on registration. | Register the token after login. |
| FCM reports the token dead | Server clears it. No more pushes until the app registers again. | Re-register on next launch. |
| App unopened for 90+ days | Token cleared by the daily job. | Re-register on launch (already in the checklist). |
| User turns push off (`pushEnabled=false`) | No pushes. Inbox and socket continue. | Reflect it in the settings screen. |
| User blocks OS notification permission | Server still sends; the OS hides it. | Deep link to OS settings from your settings screen. |
| Account suspended or deleted | Pushes stop; API returns `401`. | Show login/blocked message. |
| Same event twice | The server prevents duplicate inbox rows (unique per user, type and source), so retries do not double rows. | None. |

Pushes are retried by the server up to 5 times with exponential backoff on temporary FCM errors, and a retry only targets the members who have not received it yet.

---

## 11. Testing

1. Log in on a physical device (iOS push does not work on the simulator in most setups) and call `PUT /mobile/push-token`. Confirm `200`.
2. Trigger something that pushes, using an admin account on the admin panel:
   - publish a post in a community the test member belongs to (needs `postNotificationsEnabled` and `pushEnabled` both on),
   - extend the member's subscription,
   - reply to or resolve the member's support ticket,
   - send a message or quote on the member's service request.
3. Verify all three: the banner (background/killed), the inbox row and `unreadCount`, and the socket message (foreground).
4. Exercise the tap path from killed, background and foreground.
5. Exercise logout, then confirm no push arrives; log in again and confirm it resumes after re-registering.

**If no push arrives**, check in this order:

1. `PUT /mobile/push-token` returned `200` for the current session (not `404`).
2. `GET /mobile/push-settings` shows `pushEnabled: true`.
3. For post events: `postNotificationsEnabled` is on, and the member has an active subscription (`validUntil` today or later) in that community. The member who published it never gets it.
4. The event actually pushes (section 6.2). Recommendations and comment replies no longer notify at all.
5. Server side: `FCM not configured, push skipped` in the worker log means the deployment has no Firebase credentials; the Firebase project must match the app (section 3); and the worker process (`worker.ts`) must be running, because pushes are sent from it, not from the API process.
6. Android: notification permission and channel; iOS: APNs key in Firebase and permission granted.

Non-production environments can set `FCM_FAKE_URL` so the backend POSTs push messages to a stand-in server instead of Firebase. If your environment does this, no real device will receive anything.
