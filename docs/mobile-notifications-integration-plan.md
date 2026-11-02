# Mobile notifications: integration plan (in-app and push)

Audience: the mobile developer (Flutter). This is the **work plan**: what to build, in what order, and how to know each step is done.

The API and payload details are not repeated here. Keep these open while you work:

| Document | Use it for |
|---|---|
| `docs/firebase-fcm-setup.md` | Firebase, `google-services.json`, APNs key, device setup |
| `docs/mobile-push-integration.md` | Token lifecycle, push settings, push payload |
| `docs/mobile-notifications.md` | Inbox, live socket, routing table, no-double-notification rules, test checklist |

Authentication for every call below is the `mobile_session_id` cookie from login.

## 0. What you are building

Three channels carry the same notification, with the same `data` routing object:

| Channel | App state | Your job |
|---|---|---|
| Inbox (REST) | Always | Source of truth: list, badge, mark read |
| Live socket `/ws/notifications` | Foreground | Instant list and badge update, in-app banner |
| Push (FCM) | Background or closed | System banner (the OS shows it) and tap routing |

The server always sends all three. You decide what the member sees, so that they see each notification **once**.

## 1. Before you start (blockers and prerequisites)

| # | Item | Owner | Check |
|---|---|---|---|
| 1 | Firebase project exists and the Android and iOS apps are registered | Firebase owner | You have `google-services.json` and `GoogleService-Info.plist` |
| 2 | APNs auth key (.p8) uploaded in the Firebase console | Apple and Firebase owner | iOS push cannot work without it |
| 3 | Backend has the Firebase service account credentials (`docs/firebase-fcm-setup.md` section 3) | Backend | Ask the backend developer to send you one test push to your token before you build UI |
| 4 | A real iPhone for testing | You | The iOS simulator does not give a usable push token |
| 5 | Two test accounts (members) and access to the admin dashboard | You | Needed to trigger tickets, service updates and posts |

Do not start Phase 3 until blocker 3 is confirmed. Phases 1 and 2 do not need push.

## 2. Phases at a glance

| Phase | Goal | Depends on |
|---|---|---|
| 1 | Inbox, bell badge and routing | Login only |
| 2 | Live socket and in-app banner | Phase 1 |
| 3 | Push setup, token lifecycle, settings toggle | Blockers 1 to 3 |
| 4 | Push handling, tap routing, no double notifications | Phases 1 to 3 |
| 5 | Hardening, edge cases, full QA | Phase 4 |

Each phase ends in a state that can be merged on its own.

---

## Phase 1: Inbox, badge and routing

### Tasks

1. **Notification model and repository.** Fields: `id`, `communityId` (nullable), `type`, `title`, `message`, `data` (nullable `Map<String, String>`), `isRead`, `createdAt`, `updatedAt`. Parse tolerantly: unknown extra fields are ignored, `data` may be `null`.
2. **API calls** (`docs/mobile-notifications.md` section 2):
   - `GET /api/v1/notifications?pageSize=&communityId=&cursor=` (page with `cursor` = the previous response's `nextCursor`, not page numbers)
   - `GET /api/v1/notifications/unread-count`
   - `PATCH /api/v1/notifications/:id/read`
   - `PATCH /api/v1/notifications/mark-all-read`
3. **Inbox screen.** Paginated list (infinite scroll by `cursor`, `pageSize` 20, newest first), pull to refresh, unread styling, "Mark all read" action, empty and error states. Optional community filter.
4. **Bell badge.** Show `unread-count` on the bell in the app bar. One shared state holder (provider, bloc or similar) used by the badge and the inbox, because the socket will update both in Phase 2.
5. **Central routing function** `routeNotification(Map<String, dynamic> data)` (`docs/mobile-notifications.md` section 4). It is the only place that maps `data.type` to a screen. Rules:
   - `post`, `feed`, `recommendation`, `ticket`, `service`, `subscription` open their screens.
   - Anything else, or `data == null`, opens the inbox.
   - `feed` never switches community (the free community has no `communityId`).
   - If the target is gone (deleted post, closed account), show a short message and open the inbox. No blank screens.
6. **Tap on an inbox row:** mark it read, update the badge, then `routeNotification(item.data)`.
7. **Mark-read on conversation open.** When the member opens a ticket or service chat from anywhere, mark the inbox rows with the same `data.type` and `data.id` as read (section 3b of the notifications guide).
8. **Refresh triggers.** Refetch the inbox page 1 and the unread count on login, on app start and on every return to the foreground.
9. **401 handling.** Any `401` sends the member to login (same as the rest of the app).

### Acceptance criteria

- Inbox loads, paginates and refreshes; the badge equals `unread-count`.
- Tapping a row of each `data.type` in the routing table opens the correct screen.
- A row with an unknown `data.type` or `data: null` opens the inbox and does not crash.
- A service-request row (`communityId: null`) opens correctly.
- Opening a ticket chat directly clears the matching rows and lowers the badge.

---

## Phase 2: Live socket and in-app banner

### Tasks

1. **Socket client** for `wss://<host>/ws/notifications`, sending the `mobile_session_id` cookie. Wrap it in one class with `connect()`, `disconnect()`, a `Stream` of events and an `isConnected` flag.
2. **Lifecycle.** Connect when the app is in the foreground and logged in. Disconnect when the app goes to the background and on logout. Never keep a background socket.
3. **Event handling** (`notification.created`):
   - Insert `notification` at the top of the inbox state; ignore it if that `id` is already held.
   - Set the badge from `unreadCount`.
   - Show an in-app banner (title, message) whose tap calls `routeNotification(notification.data)`.
4. **"Already looking at it" rule.** Keep a single "currently open conversation" value (`type` and `id`) set by the ticket and service chat screens. If an event's `data.type` and `data.id` match it, show no banner and call `PATCH /:id/read` straight away.
5. **Close handling.**
   - Code `4401`: the session ended (logout or login on another phone). Do not reconnect. Clear local state and go to login.
   - Any other close: reconnect with backoff (1 s, 2 s, 4 s, ... up to 30 s). After each successful reconnect, **refetch the inbox page 1 and the unread count once**, because missed events are not replayed.
   - HTTP `401` on connect: treat like `4401`.
6. **In-app banner widget.** Overlay at the top of the app (not inside one screen), auto-dismisses after about 4 seconds, one at a time (a new one replaces the old), tap to open.

### Acceptance criteria

- Replying to a ticket from the admin dashboard while the app is open on the home screen: badge goes up, row appears at the top, **one** in-app banner, tapping it opens the ticket.
- With that same ticket chat open: the message shows in the chat, **no** banner, badge does not rise.
- Airplane mode on and off: socket reconnects with backoff and the inbox then shows the missed item.
- Logging in on a second phone closes the first phone's socket with `4401` and the first phone goes to login without a reconnect loop.

---

## Phase 3: Push setup, token lifecycle and settings

### Tasks

1. **Dependencies.** `firebase_core`, `firebase_messaging`, `flutter_local_notifications`.
2. **Platform setup** (follow `docs/firebase-fcm-setup.md` sections 4 and 5):
   - Android: `google-services.json`, Google Services Gradle plugin, notification permission (`POST_NOTIFICATIONS`, Android 13+), a default notification channel.
   - iOS: `GoogleService-Info.plist`, **Push Notifications** capability, **Background Modes, Remote notifications**, APNs key already in Firebase.
3. **Initialise Firebase** at app start and register the background message handler (a top-level function) even if it does nothing; the OS shows the banner for messages that carry a `notification` block.
4. **Permission prompt.** Ask after login with a short explanation screen, not on first launch. If denied, do not nag; offer a link to system settings from the settings screen. Treat "denied" as "no token".
5. **Token lifecycle** (`docs/mobile-push-integration.md` section 3):

   | Moment | Action |
   |---|---|
   | Login | `getToken()`, then send `fcmToken` (and `appVersion`) with `POST /api/v1/auth/mobile/login`, or call `PUT /api/v1/mobile/push-token` right after |
   | App launch | `getToken()`; if it differs from the last value sent, or about 24 hours have passed, `PUT /api/v1/mobile/push-token` |
   | `onTokenRefresh` | `PUT /api/v1/mobile/push-token` immediately |
   | System permission turned off | `DELETE /api/v1/mobile/push-token` |
   | Logout | Normal logout; the backend drops the token with the session. Optionally `deleteToken()` locally |

   Store the last token sent and the time (secure local storage) so you only call the API when needed. The call is idempotent, so an extra call is harmless.
6. **Settings toggle.** "Push notifications" switch bound to `GET` and `PATCH /api/v1/mobile/push-settings` (`{ "pushEnabled": bool }`). Show the system-permission state next to it. Muting push does not affect the inbox or the socket.
7. **Error handling.** `422` on the token call means the token looks invalid: call `getToken()` again once, then give up quietly. Never block login or the UI on a push failure.

### Acceptance criteria

- After login with permission granted, `PUT /push-token` returns 200 (or the login response confirms the token).
- The backend developer's test push reaches the device on both Android and a real iPhone.
- Reinstall and log in again: a new token is registered.
- Log out and log in as a different member on the same phone: only the new member's pushes arrive.
- The settings toggle off stops pushes; inbox and in-app banner still work.

---

## Phase 4: Handling pushes and avoiding duplicates

### Tasks

1. **Tap handling** with the same `routeNotification` from Phase 1, in all three app states:
   ```dart
   FirebaseMessaging.onMessageOpenedApp.listen((m) => routeNotification(m.data));   // background
   final first = await FirebaseMessaging.instance.getInitialMessage();               // cold start
   if (first != null) routeNotification(first.data);
   ```
   For a cold start, wait until the app is logged in and the navigator is ready before routing; if there is no session, go to login and drop the route.
2. **After a push tap**, refetch the inbox and mark the matching rows read (same `data.type`, `data.id`, `event`), because a push carries no inbox id.
3. **Foreground rules** (`docs/mobile-notifications.md` section 6):
   - Do **not** call `setForegroundNotificationPresentationOptions(alert: true, ...)` on iOS. Leave the default (off).
   - In `onMessage`: if the socket is connected, do nothing (the socket already drives the UI). If the socket is **not** connected, show a local notification or in-app banner from the push, and refetch the inbox when the socket comes back.
   - Never create a local notification from `onMessage` in any other case.
4. **Notification channel (Android).** One high-importance channel for these notifications, with a clear name (for example "Account and activity"), so members can tune it in system settings.
5. **Badge on the app icon (optional).** If you set the launcher badge, set it from the unread count.
6. **Unknown payloads.** A push with an unknown `data.type` or without `data` opens the inbox. Do not throw.

### Acceptance criteria

- The 12-step checklist in `docs/mobile-notifications.md` section 8 passes on Android and on a real iPhone.
- Specifically: foreground gives exactly one in-app banner and no system banner; background and closed give exactly one system banner; tap routes correctly from all three states.
- Five quick replies while backgrounded give five banners (grouped under the ticket on iPhone) and five inbox rows.

---

## Phase 5: Hardening and release

### Tasks

1. **Edge cases to test and fix**
   - Push tap while logged out (session expired): go to login, then route after login if the target is still valid.
   - Two taps in a row on different pushes.
   - Rotating the device or hot-restarting during a banner.
   - Very long titles and messages (truncate in the banner and the list).
   - Large unread count (`99+` in the badge).
   - Device clock and timezone: show `createdAt` in local time.
   - Backgrounding during an inbox fetch.
2. **Logging and diagnostics.** In debug builds, log token registration results, socket state changes and the decision made for each notification (banner, skipped, local). Never log full tokens in release builds.
3. **Tests.**
   - Unit: `routeNotification` for every `data.type`, `null`, and an unknown type; notification JSON parsing with missing and extra fields; the "already looking at it" rule; the foreground decision table.
   - Widget: inbox list states, badge, banner.
   - Manual: the test matrix below.
4. **Release checklist**
   - Production `google-services.json` and `GoogleService-Info.plist` (not the dev ones).
   - Production APNs key configured; iOS build uses the production `aps-environment` entitlement.
   - Store listing and Info.plist strings for the permission prompt are in place.
   - `appVersion` is sent with the token.

### Test matrix (run each on Android and iPhone)

| App state | Trigger | Expected |
|---|---|---|
| Foreground, other screen | Ticket reply | One in-app banner, badge +1, no system banner |
| Foreground, same chat | Ticket reply | No banner, message in chat, badge unchanged |
| Foreground, socket down | Ticket reply | One local banner, inbox refetched on reconnect |
| Background | Ticket reply | One system banner, tap opens ticket |
| Closed | Ticket reply | One system banner, tap cold starts into the ticket |
| Any | Quote sent | "Your quote is ready" (no amount), opens service chat |
| Any | Payment received | "Payment received", opens service chat |
| Any | New community post | Banner, opens post (new recommendations no longer notify) |
| Any | Free-community post | Routes as `feed`, no community switch |
| Any | Subscription expiring or expired | Opens subscription screen with renew option |
| Push off in settings | Any event | No push, inbox and in-app banner still work |
| Two phones | Login on the second | First phone's socket closes `4401`, goes to login, no more pushes |
| Airplane mode | Event while offline | Inbox catches up after reconnect |

---

## 3. Suggested structure (adapt to your architecture)

```
notifications/
  data/        notification_model.dart, notifications_api.dart, push_api.dart
  state/       inbox_store, unread_badge_store, open_conversation_tracker
  socket/      notifications_socket.dart
  push/        push_service.dart (permission, token lifecycle, handlers)
  routing/     notification_router.dart
  ui/          inbox_screen, notification_tile, in_app_banner, push_settings_tile
```

Keep three things as single sources of truth: the **router** (one function), the **inbox and badge state** (shared by REST, socket and push), and the **open conversation tracker** (used to suppress banners).

## 4. Common mistakes to avoid

1. Routing on the inbox `type` instead of `data.type`.
2. Treating `data` values as non-strings (they are all strings) or assuming `communityId` is always present.
3. Turning on iOS foreground presentation, which doubles every banner.
4. Showing a local notification for every foreground push (only when the socket is down).
5. Reconnecting the socket after close code `4401`.
6. Forgetting to refetch the inbox after a socket reconnect or a push tap.
7. Relying on push alone. Delivery is best effort; the inbox is the truth.
8. Asking for notification permission on first launch.
9. Testing iOS only on the simulator.

## 5. Questions to settle with the backend developer early

1. Which environment and base URL do the push tests use, and is the service account configured there?
2. Can they send a test push to your token (Phase 3 gate)?
3. Do admins who log in on mobile need to see admin-only notification types (`new-member-registered`, `import-complete`, ...) in the inbox? The guide says show them and open the inbox when they cannot be routed.
4. Who owns the Firebase and Apple accounts for production keys?
