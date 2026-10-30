# Notifications module: guide for the mobile app

This guide covers everything the app needs for notifications: the **inbox** (REST), the **live socket** while the app is open, the **push** when it is not, how to **open the right screen** from any of them, and how to **avoid showing the same notification twice**.

Setup of push itself (Firebase, tokens, permissions) is in `mobile-push-integration.md` and `firebase-fcm-setup.md`. This file is the one to read for behaviour.

Authentication is the same as every other mobile call: the `mobile_session_id` cookie from login.

## 1. The three channels and who does what

| Channel | When | What it is for |
|---|---|---|
| **Inbox** (REST) | Always | The full history. Source of truth. Load it when the app starts or comes to the foreground. |
| **Live socket** `/ws/notifications` | App is **open** and connected | Updates the inbox list and the bell badge instantly, and lets the app show its own in-app banner. |
| **Push** (FCM) | App is **in the background or closed** | The phone's system banner. A nudge to open the app. |

For every notification the server saves **one inbox row**, publishes it on the **socket**, and sends a **push**. It always does all three, even if the app is open. The server cannot tell reliably whether the app is really in use, so the app chooses what to show (section 6).

## 2. The inbox (REST)

### List

```
GET /api/v1/notifications?page=1&pageSize=20&communityId=<uuid>
```

- `page` starts at 1. `pageSize` is 1 to 50 (default 20). `communityId` is optional and filters to one community.
- Newest first.

Response `200`:

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "2cd73195-8b9e-4c56-b164-c4419537e138",
        "communityId": "10000000-0000-4000-8000-0000000000c1",
        "type": "ticket-update",
        "title": "Support replied to your ticket",
        "message": "We are looking into your payment now…",
        "data": { "type": "ticket", "id": "7bfb5ee6-…", "event": "reply", "communityId": "10000000-…" },
        "isRead": false,
        "createdAt": "2026-10-30T10:16:29.000Z",
        "updatedAt": "2026-10-30T10:16:29.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

| Field | Notes |
|---|---|
| `id` | Use it to mark the item read. |
| `communityId` | **Can be `null`** (service requests belong to no community). |
| `type` | The kind of notification (section 3). Only for icons and grouping. **Do not route on it**; use `data.type`. |
| `title`, `message` | Ready-to-show text. |
| `data` | The routing information (section 4). `null` on very old rows, so fall back to opening the inbox. |
| `isRead` | `false` until read. |

### Unread count (for the bell badge)

```
GET /api/v1/notifications/unread-count
```
Response: `{ "success": true, "data": { "count": 3 } }`

### Mark one read

```
PATCH /api/v1/notifications/:id/read
```
Response `200`: `{ "success": true, "message": "Notification marked as read" }`. `404` if the id is not yours.

### Mark all read

```
PATCH /api/v1/notifications/mark-all-read
```
Response `200`: `{ "success": true, "data": { "count": 5 } }` (how many were changed).

Errors for all of them: `401` when not logged in (send the user to login).

## 3. What `type` values exist

Every notification a **member** can receive:

| `type` | Shown as | Push is sent? |
|---|---|---|
| `post` | A new post in a community | Yes |
| `recommendation` | A new stock recommendation | **No** (inbox and live socket only) |
| `thread` | Someone replied to your comment | **No** (inbox and live socket only) |
| `ticket-update` | Support replied to your ticket, or it was resolved | Yes |
| `service-update` | Service request activity (reply, quote, payment, closed, quote expired) | Yes |
| `subscription-extended` | Your access was extended | Yes |
| `community-added` | You were added to a community | Yes |
| `subscription-expiring-7-days`, `subscription-expiring-1-day` | Access ending soon | Yes |
| `subscription-expired` | Access ended | Yes |

Admins who log in on mobile can also get `new-member-registered`, `new-member-reply`, `reaction`, `import-complete`, `admin-unreplied-digest` and `admin-expiry-report`. These are for the web dashboard. The mobile app should show them in the inbox like any other item and, if it cannot route them, simply open the inbox.

**Unknown `type` or `data.type` values must never crash the app.** New kinds will be added. Show the item and open the inbox when tapped.

**Each ticket and service event is its own row**, so one ticket with five replies is five inbox items. They share `data.id`, so the app can group them by conversation if it wants.

## 4. The routing data: where to send the member

Every notification carries `data`. It is the same object in all three channels (the inbox item, the socket event, and the push), so one routing function serves everything.

```json
{ "type": "ticket", "id": "7bfb5ee6-…", "event": "reply", "communityId": "10000000-…" }
```

- `type`: which module/screen.
- `id`: the thing to open (post id, ticket id, request id, community id...).
- `communityId`: present when the item belongs to a community.
- `event`: what happened (optional, for choosing a sub-screen).
- **All values are strings.**

### Route by `data.type`

| `data.type` | `data.id` is | `data.event` | Open this screen |
|---|---|---|---|
| `post` | post id | none | That post. Use `communityId` to switch to the right community if needed. |
| `feed` | post or recommendation id | none | The **general feed** (the free community's content has no community of its own). Open that post or recommendation in the feed. |
| `recommendation` | recommendation id | none | That recommendation, in the `communityId` community. |
| `ticket` | ticket id | `reply`, `resolved` | That ticket's chat. After `resolved`, the chat is read-only and shows the rating prompt. |
| `service` | service request id | `reply`, `quote`, `paid`, `closed`, `quote-expired` | That request's chat. For `quote`, scroll to or highlight the quote card. For `paid`, the invoice is ready. |
| `subscription` | **community id** | `extended`, `community-added`, `expiring-7`, `expiring-1`, `expired` | That community's subscription / plans screen. For `expiring-*` and `expired`, show the renew option. |
| anything else | n/a | n/a | Open the notification inbox. |

`feed` is the one to watch: when the item belongs to the **free** community, `data.type` is `feed` and there is **no** `communityId`, so do not try to switch community.

Admin-only routing values you may see and can treat as "open the inbox": `member`, `members`, `threads`, `subscriptions`.

### One routing function

```dart
void routeNotification(Map<String, dynamic> d) {
  final type = d['type'] as String?;
  final id = d['id'] as String?;
  final communityId = d['communityId'] as String?;
  switch (type) {
    case 'post':           return openPost(id!, communityId: communityId);
    case 'feed':           return openFeedItem(id!);
    case 'recommendation': return openRecommendation(id!, communityId: communityId);
    case 'ticket':         return openTicket(id!);
    case 'service':        return openServiceRequest(id!, event: d['event']);
    case 'subscription':   return openSubscription(communityId ?? id!, event: d['event']);
    default:               return openNotificationInbox();
  }
}
```

Call it from three places, always with the same `data`:
1. A tap on an **inbox row** (`item.data`).
2. A tap on a **push** (`message.data`).
3. A tap on an **in-app banner** you show from a socket event (`event.notification.data`).

If the target no longer exists (deleted post, closed account), show a short message and open the inbox. Do not leave a blank screen.

## 3b. Marking items read

- When the member taps an **inbox row**: call `PATCH /api/v1/notifications/:id/read` and update the badge.
- When the member opens a ticket or request chat from anywhere, the inbox rows for that conversation are still unread. After the screen opens, mark the matching rows read (same `data.type` and `data.id`) so the bell badge does not stay lit for something they just read.
- A push carries no inbox id, so after a push tap, refetch the inbox and mark the matching rows (same `data.type`, `data.id` and `event`).
- The bell badge is always `GET /unread-count`, or the `unreadCount` from the socket event.

## 5. The live socket (while the app is open)

```
wss://<host>/ws/notifications      (send the mobile_session_id cookie)
```

Without a valid session the connection is refused with HTTP 401. Open it when the app is in the foreground and close it when the app goes to the background.

For every new or refreshed notification the server sends:

```json
{
  "event": "notification.created",
  "notification": { "id": "…", "communityId": "…", "type": "ticket-update", "title": "…", "message": "…", "data": { "type": "ticket", "id": "…", "event": "reply" }, "isRead": false, "createdAt": "…", "updatedAt": "…" },
  "unreadCount": 4
}
```

- `notification` is the same shape as an inbox item. Put it at the top of the list.
- `unreadCount` is the new total: set the badge from it.
- If you already hold that `notification.id` (after a reconnect), ignore the duplicate.
- **Close code `4401`**: the session ended (logout or a login on another phone). Do not reconnect. Go to login.
- Any other close: reconnect with a short backoff (1s, 2s, 4s, up to 30s), then **refetch the inbox once**, because events sent while you were disconnected are not replayed.

## 6. Avoiding double notifications when the app is open

The same event arrives as a socket message and as a push. The member must see it **once**. Rules:

**Rule 1: the socket drives the UI while the app is open.**
In the foreground, show the notification from the socket event (badge, inbox row, and an in-app banner if you want one).

**Rule 2: never show a system banner for a push that arrives in the foreground.**
- Android: FCM does not show a banner for a push that arrives while the app is open. Do nothing special in `onMessage`.
- iPhone: leave foreground presentation **off** (this is the default). Do **not** call `setForegroundNotificationPresentationOptions(alert: true, ...)`. If you do, iPhone shows the push banner on top of your own in-app banner.
- Do not create a local notification from `FirebaseMessaging.onMessage`, except in the one case below.

**Rule 3: only one exception: socket is down.**
If a push arrives in the foreground and the socket is **not connected**, the member would miss it. In that case show a local notification (or an in-app banner) from the push, and refetch the inbox once the socket reconnects.

**Rule 4: do not interrupt what the member is already looking at.**
If the member has the ticket (or request) chat open and a socket event arrives for **that same conversation** (`data.type == 'ticket'` and `data.id == openTicketId`), show **no** banner, and mark the notification read right away. The chat itself already shows the new message.

**Rule 5: background and closed are the push's job.**
When the app is not in the foreground the socket is closed, so the system shows the push. Tapping it opens the app and routes with `message.data`.

### The decision, in one table

| App state | Socket event | Push | What the member sees |
|---|---|---|---|
| Foreground, on a screen unrelated to it | Update badge and list, show an in-app banner | Ignore | One in-app banner |
| Foreground, viewing that same chat | Update list, mark read, **no banner** | Ignore | The message in the chat only |
| Foreground, socket down | none | Show a local banner from the push | One banner |
| Background | (socket closed) | System shows it | One system banner |
| Closed | (socket closed) | System shows it | One system banner |
| Coming back to foreground | n/a | n/a | Refetch the inbox and the unread count |

### Sketch

```dart
// socket
socket.on('notification.created', (e) {
  final n = e['notification'];
  inbox.insertAtTop(n);
  badge.set(e['unreadCount']);
  if (isViewing(n['data'])) { api.markRead(n['id']); return; }   // rule 4
  showInAppBanner(title: n['title'], body: n['message'],
      onTap: () => routeNotification(n['data']));                // rule 1
});

// push received while the app is open
FirebaseMessaging.onMessage.listen((m) {
  if (socket.isConnected) return;                                // rules 2 and 3
  showLocalNotification(m);                                      // socket down only
});

// push tapped (app was in the background)
FirebaseMessaging.onMessageOpenedApp.listen((m) => routeNotification(m.data));

// push tapped (app was closed)
final first = await FirebaseMessaging.instance.getInitialMessage();
if (first != null) routeNotification(first.data);

// app returns to the foreground
lifecycle.onResume(() { connectSocket(); inbox.refetch(); badge.refetch(); });
```

## 7. What the push looks like

The push has a visible `title` and `body` (so the system can show it when the app is closed) plus the same `data` as above.

```json
{
  "notification": { "title": "Support replied to your ticket", "body": "We are looking into your payment now…" },
  "data": { "type": "ticket", "id": "7bfb5ee6-…", "event": "reply", "communityId": "10000000-…" }
}
```

- Every event is its own push. Five replies give five banners, and on iPhone the banners of one ticket or request are grouped together. The app does nothing special for this.
- The lock-screen text is short on purpose. Quotes never show an amount; open the request to see it.
- Pushes are sent only to a member who has not muted them (`GET` or `PATCH /api/v1/mobile/push-settings`, `{ "pushEnabled": true|false }`). A muted member still gets inbox rows and socket events.
- **Never rely on a push alone.** Delivery is best effort, especially on iPhone. The inbox always has the item.

## 8. Test checklist

1. Log in, open the inbox: the list loads, the badge matches `unread-count`.
2. With the app **open** on the home screen, reply to the member's ticket from the admin dashboard: the badge goes up, the row appears at the top, **one** in-app banner shows, and **no** system banner appears.
3. Tap that banner: it opens the right ticket. The inbox row becomes read and the badge goes down.
4. With the same ticket chat **open**, send another reply: the message appears in the chat, no banner, and the badge does not go up.
5. Put the app in the **background**, send a reply: **one** system banner arrives. Tap it: the ticket opens.
6. **Close** the app (swipe it away), send a reply: one system banner arrives. Tap it: the app starts and opens the ticket.
7. Send five quick replies while the app is in the background: five banners, grouped under the ticket on iPhone. Opening the app shows five inbox rows.
8. Switch the phone to airplane mode while the app is open, send a reply from the dashboard, switch back: the inbox shows it after reconnect.
9. For each routing type (`post`, `feed` for a free-community post, `recommendation`, `ticket`, `service` with `quote` and `paid`, `subscription` with `expiring-1` and `expired`): tap the row and a push for it, and confirm the right screen opens each time.
10. Make a notification with an unknown `data.type` (or `data: null`): the app opens the inbox and does not crash.
11. Log out on this phone while the app is open and log in on another: the first phone's socket closes with 4401 and it goes to login.
12. Turn push off in settings: no push arrives, but the inbox and the live banner still work.

## 9. Quick reference

| Need | Call |
|---|---|
| Inbox | `GET /api/v1/notifications?page=&pageSize=&communityId=` |
| Badge | `GET /api/v1/notifications/unread-count` |
| Read one | `PATCH /api/v1/notifications/:id/read` |
| Read all | `PATCH /api/v1/notifications/mark-all-read` |
| Live updates | `wss://<host>/ws/notifications` (event `notification.created`) |
| Register push token | `PUT /api/v1/mobile/push-token` |
| Mute push | `PATCH /api/v1/mobile/push-settings` |
| Where to go | `data.type` and `data.id` (same in inbox, socket and push) |
