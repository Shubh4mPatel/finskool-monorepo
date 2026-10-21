# Push notifications: mobile integration guide

The backend sends push notifications through Firebase Cloud Messaging (FCM). On iPhones FCM hands the message to Apple's APNs. This guide is what the mobile app must do. Everything else (when to send, who gets what) is handled by the backend.

Authentication is the same as every other mobile call: the `mobile_session_id` cookie from login.

## 1. The model in one minute

- One member has **one mobile session**, and so **one push device**. Logging in on a new phone ends the old session and the old phone stops receiving pushes.
- The app gives the backend its FCM token. The token belongs to the phone, not the person. The backend stores it on the member's session.
- A push is only a nudge. Every push also creates (or refreshes) an entry in the **in-app notification inbox**, and the inbox is the source of truth if a push never arrives.

## 2. Setup (once)

1. Add `firebase_messaging` (and `flutter_local_notifications` to show banners while the app is open).
2. Android: add `google-services.json`. iOS: add `GoogleService-Info.plist`, enable the **Push Notifications** capability and **Background Modes, Remote notifications**, and make sure the backend team has uploaded the APNs key (.p8) in the Firebase console. Test iOS on a real iPhone.
3. Ask for notification permission at a sensible moment (after login, with a short explanation), not on first launch.

## 3. Token lifecycle (the three rules)

| Moment | The app does |
|---|---|
| Login | Call `getToken()`, then send it with the login request (`fcmToken`), **or** call `PUT /api/v1/mobile/push-token` right after login. |
| App launch | Call `getToken()`. If it differs from the last token you sent, or more than about 24 hours have passed, call `PUT /api/v1/mobile/push-token`. |
| `onTokenRefresh` fires | Call `PUT /api/v1/mobile/push-token` immediately with the new token. |
| Logout | Call the normal logout. Nothing else is required: logging out deletes the session and the token with it. (Optionally also call `deleteToken()` on the device.) |

If the user turns notifications off in the phone's system settings, call `DELETE /api/v1/mobile/push-token`.

### Register or refresh the token

```
PUT /api/v1/mobile/push-token
{ "token": "<fcm token>", "platform": "android", "appVersion": "1.2.0" }
```

`platform` and `appVersion` are optional. The call is idempotent, so calling it too often is harmless. Response: `{ "success": true, "data": null }`.

If a different member was still holding the same phone's token, it is moved to the member calling now. Errors: `401` not logged in, `422` the token looks invalid.

### Send the token with login (optional shortcut)

`POST /api/v1/auth/mobile/login` accepts two extra optional fields: `fcmToken` and `appVersion`. A login without `fcmToken` leaves the session with no token (the previous phone's token is never kept), so call `PUT /push-token` afterwards.

### Remove the token

```
DELETE /api/v1/mobile/push-token
```

## 4. The master switch

```
GET   /api/v1/mobile/push-settings          -> { "pushEnabled": true }
PATCH /api/v1/mobile/push-settings          { "pushEnabled": false }
```

Use it for a "Push notifications" toggle in the app's settings screen. When off, nothing is pushed, but the inbox still fills. (The existing "post notifications" setting separately controls community post notifications.)

## 5. What a push looks like

Every push has a visible title and body (so the system shows it even when the app is closed) plus a `data` map for routing. **All data values are strings.**

| `data.type` | `data.id` | `data.event` | Other keys | Open this screen |
|---|---|---|---|---|
| `post` | post id | none | `communityId` | The post / announcements |
| `ticket` | ticket id | `reply`, `resolved` | `communityId` | That ticket's chat |
| `service` | service request id | `reply`, `quote`, `paid`, `closed`, `quote-expired` | none | That service request's chat |
| `subscription` | community id | `expiring-7`, `expiring-1`, `expired`, `extended`, `community-added` | `communityId` | Subscription / community screen |

Ticket and service pushes **replace** the previous banner for the same ticket or request, so a long chat does not stack ten banners.

Lock-screen text is deliberately short and never contains amounts, invoice links or personal details. For example a quote push says "Your quote is ready", not the price.

## 6. Handling pushes in the app

- **App closed or in the background:** the system shows the banner. When the user taps it, read `message.data` and navigate using the table above.
- **App open (foreground):** FCM does not show a banner by itself. Either show one with `flutter_local_notifications` or ignore the push and rely on the live socket (`/ws/tickets`) which already updates open chats instantly. The backend always sends the push, even when the app is open, so the app decides how to show it.
- **Cold start from a tap:** use `FirebaseMessaging.instance.getInitialMessage()`.

```dart
FirebaseMessaging.onMessageOpenedApp.listen((m) => route(m.data));
final initial = await FirebaseMessaging.instance.getInitialMessage();
if (initial != null) route(initial.data);

void route(Map<String, dynamic> d) {
  switch (d['type']) {
    case 'ticket':       openTicket(d['id']); break;
    case 'service':      openServiceRequest(d['id']); break;
    case 'post':         openPost(d['id']); break;
    case 'subscription': openSubscription(d['communityId'] ?? d['id']); break;
  }
}
```

Treat unknown `type` values as "open the notification inbox" so new kinds never break the app.

## 7. The in-app inbox

The existing notification endpoints now also return ticket and service updates:

```
GET   /api/v1/notifications?page=1&pageSize=20     (optional &communityId=...)
GET   /api/v1/notifications/unread-count
PATCH /api/v1/notifications/:id/read
PATCH /api/v1/notifications/mark-all-read
```

Each item:

```json
{
  "id": "…", "communityId": "…" | null, "type": "ticket-update",
  "title": "Support replied to your ticket", "message": "We are looking into…",
  "data": { "type": "ticket", "id": "…", "event": "reply", "communityId": "…" } | null,
  "isRead": false, "createdAt": "…", "updatedAt": "…"
}
```

Things to handle:

- `communityId` can be `null` (service requests belong to no community).
- `data` is the same routing information as in the push. Use it to open the right screen when an inbox row is tapped. It is `null` on older rows, so fall back to `type`.
- New `type` values: `ticket-update` and `service-update`. **Every event gets its own inbox row**, so the inbox is a full history: each admin reply, each quote, the payment, the closing and so on. A long chat adds one row per admin message. Rows for the same ticket or request share `data.id`, so the app can group or filter them by thread if it wants to.
- Load the inbox on app launch and when the app returns to the foreground, so nothing is missed if a push was dropped.

## 7b. The live notification socket (while the app is open)

One WebSocket carries **every** notification (posts, subscription reminders, tickets, services) to the open app: `wss://<host>/ws/notifications`. Send the same `mobile_session_id` cookie as for every other call. Without a valid session the upgrade is refused with HTTP 401.

Each time a notification is created or refreshed for the member, the server sends:

```json
{
  "event": "notification.created",
  "notification": { "id": "…", "communityId": "…" | null, "type": "ticket-update", "title": "…", "message": "…", "data": { "type": "ticket", "id": "…", "event": "reply" }, "isRead": false, "createdAt": "…", "updatedAt": "…" },
  "unreadCount": 3
}
```

- `notification` has exactly the same shape as an item in `GET /api/v1/notifications`. Insert it at the top of the inbox list. (If the app already holds that `id`, for example after a reconnect and refetch, ignore the duplicate.)
- `unreadCount` is the member's new total, so set the bell badge from it.
- If the session ends (logout, or a login on another phone), the server closes the socket with code **4401**. Do not reconnect until the member logs in again. Any other close: reconnect with a short backoff, then refetch the inbox once.
- Load the inbox with REST on app start, then keep it current from the socket. The socket only covers the time the app is open and connected.
- The server sends the push **and** the socket event. While the app is in the foreground FCM shows no banner by itself, so the app shows no duplicate; the socket updates the inbox and badge. When the app is in the background or closed, the system shows the push.

## 8. When a member gets a push

| Event | Push |
|---|---|
| New community post | To members of that community who have post notifications on (recommendations are not pushed) |
| Admin replies to a ticket | "Support replied to your ticket" |
| Ticket resolved | "Your ticket was resolved" |
| Admin message in a service chat | "New message about your service request" |
| Quote sent or revised | "Your quote is ready" / "Your quote was updated" |
| Payment confirmed (invoice ready) | "Payment received" |
| Service closed by admin | "Your service is complete" / "Your service request was closed" |
| Quote expired | "Your quote expired" |
| Subscription expiring in 7 days, 1 day, expired | Reminder |
| Plan extended, added to a community | "Access extended" / "You've been added to …" |

Members never get a push for their own actions. Admins do not receive mobile pushes.

## 9. Test checklist

1. Log in, grant permission, confirm `PUT /push-token` returns 200.
2. Send a ticket reply from the admin dashboard with the app closed: a banner arrives and tapping it opens that ticket.
3. Send a second reply: the banner is replaced, and the inbox now has a separate row for each reply.
4. Send a quote from the admin dashboard: banner "Your quote is ready", no amount shown. Tapping opens the service chat.
5. Pay a quote: "Payment received" arrives.
6. Turn the master switch off: no pushes, but the inbox still gets rows.
7. Log out, then log in as another member on the same phone: only the new member's pushes arrive. The first member gets nothing on this phone.
8. Log in on a second phone: the first phone is logged out and no longer receives pushes.
9. Reinstall the app and log in again: a new token is registered and pushes arrive.
10. Kill the app, send a push, tap it: the cold start opens the right screen.
11. Tap an inbox row for a service request: opens the chat (`communityId` is null).
12. Airplane mode for a few minutes while a reply is sent, then reconnect: the inbox shows it even if the push did not arrive.

## 10. Good to know

- Pushes are best effort, especially on iOS. Never rely on a push alone for anything important; the inbox and the screens always show the real state.
- The backend removes a token when FCM reports it dead (app uninstalled) and tokens the app has not refreshed for 90 days, so open the app now and then so it re-registers.
- Questions about delivery on a real device (Firebase and APNs setup) belong to whoever owns the Firebase project; the backend only needs the service account credentials.
