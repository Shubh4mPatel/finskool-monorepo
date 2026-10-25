# Support Tickets: Mobile Integration Guide

For the mobile developer integrating the support-ticket module into the member app. It covers what to call, in what order, what comes back, and how to handle the live (WebSocket) side. For how the whole module works end to end, including the admin dashboard, see [`support-tickets-flow.md`](./support-tickets-flow.md).

Written against `main` at commit `4eee8d2` (2026-10-18). If something here disagrees with the backend, the backend wins: please tell us.

## 1. What you are building

A member raises a ticket against one of their communities, chats with the support team about it, and rates it once it is resolved.

| Screen | What it needs |
|---|---|
| **My tickets** (list + unread badge) | `GET /` (paged), `GET /unread-count`, live events |
| **Raise a ticket** (form) | `GET /communities`, upload files, `POST /` |
| **Ticket detail / chat** | `GET /:id`, then the socket for history, send and read |
| **Rating sheet** | `POST /:id/rating` |

**How the two channels split the work:**

- **REST** is for tickets, communities, uploads, rating and attachment links.
- **WebSocket** is for the chat itself (send, history, mark read) and for every live update. **There are no REST endpoints for chat.** If the socket is down the member cannot send or load messages, so build a visible "reconnecting" state.

## 2. Conventions

| | |
|---|---|
| REST base | `https://<api-host>/api/v1/mobile/tickets` (every path below is relative to this) |
| Socket URL | `wss://<api-host>/ws/tickets` (use `ws://` only for local dev) |
| Auth | The `mobile_session_id` cookie set by the login call (`POST /api/v1/auth/mobile/login`). It is httpOnly and there is no token in a response body. |
| Success body | `{ "success": true, "data": … }` |
| Error body | `{ "success": false, "message": "…", "code": "SOME_CODE" }` (`code` is not always present) |
| Validation error (HTTP 422) | `{ "success": false, "message": "Validation failed", "errors": { "subject": ["Subject is required"] } }` |
| Ids | UUID strings. Timestamps are ISO 8601 in UTC (`2026-10-18T09:03:11.123Z`). |
| Pagination | Cursor based: send the `nextCursor` you were given as `cursor` (REST) or `before` (chat history). `nextCursor: null` means no more pages. Treat a cursor as an opaque string. |
| Ticket label | Show `label` (`FS-2041`), not `number` or `id`. |

Calling these endpoints with a web (dashboard) login returns 403 `MOBILE_ONLY`. A logged-out or replaced session returns 401 `SESSION_INVALIDATED`: send the user back to login.

## 3. Authentication, for both REST and the socket

REST: your HTTP client must keep the cookie jar and send `mobile_session_id` on every request (the same as the rest of the app).

Socket: the WebSocket upgrade request must carry the **same cookie**. Many WebSocket libraries do **not** share the HTTP client's cookie jar. If yours does not, read `mobile_session_id` from the jar and set the `Cookie: mobile_session_id=<value>` header on the upgrade request yourself.

If the cookie is missing or the session is no longer valid, the upgrade is refused with HTTP **401**. Do not retry in a tight loop; check the session (for example `GET /api/v1/auth/mobile/me`) and go to login if it is invalid.

## 4. Data shapes

### Ticket (what the list and detail return)

```json
{
  "id": "41aeca02-b9e8-48bf-88e5-a42a35f072ca",
  "number": 2041,
  "label": "FS-2041",
  "communityId": "1c9f…",
  "communityName": "Swing Traders",
  "category": "payments",
  "type": "issue",
  "subject": "Payment failed",
  "description": "Money deducted but no access",
  "status": "in_progress",
  "attachments": [ /* files attached to the original description, see Attachment */ ],
  "lastMessageAt": "2026-10-18T09:03:11.123Z",
  "rating": null,
  "ratingComment": null,
  "ratedAt": null,
  "resolvedAt": null,
  "createdAt": "2026-10-18T08:55:02.411Z",
  "assignedAdminName": "Admin One",
  "unreadCount": 2
}
```

| Field | Notes |
|---|---|
| `status` | `open` (nobody has picked it up), `in_progress` (an admin owns it), `resolved` (final). Suggested labels: Open / In Progress / Resolved. |
| `category` | `payments`, `subscription`, `account`, `content`, `app_bug`, `other` |
| `type` | `issue`, `question`, `feature_request`, `refund_request` |
| `assignedAdminName` | `null` until an admin claims or replies. Show it as "Handled by …" if you like. |
| `unreadCount` | Admin replies this member has not read yet, for this ticket. Drives the dot / badge on the row. |
| `lastMessageAt` | The list is sorted by this, newest first. It starts equal to `createdAt`. |
| `rating` / `ratingComment` / `ratedAt` | `null` until the member rates. |
| `resolvedAt` | `null` until resolved. |

### Message

```json
{
  "id": "7b0e…",
  "ticketId": "41ae…",
  "senderId": "1000…",
  "senderRole": "admin",
  "senderName": "Admin One",
  "body": "We are checking this.",
  "clientMessageId": "2d6c9f0e-3a11-4c2e-9b0a-6f2a8f7a1c55",
  "attachments": [],
  "createdAt": "2026-10-18T09:03:11.123Z"
}
```

- `senderRole` is `user` (the member) or `admin`. Use it to decide which side of the chat bubble to draw (`user` is the member, so it is "me").
- `body` is `null` for a file-only message.
- Show the **ticket description as the first message** of the conversation yourself: it is not part of the message history. Its files are `ticket.attachments`.

### Attachment

```json
{ "id": "a1f3…", "fileName": "screenshot.png", "mimeType": "image/png", "sizeBytes": 183422, "url": "https://…signed…" }
```

`url` is a signed link that **expires in about 5 minutes**. See "Attachment links" in section 7.

## 5. REST endpoints

### `GET /communities`

The communities the member can raise a ticket against: every community they hold or ever held a subscription for, free community included. Feeds the community picker.

Response `data`: `[ { "id": "…", "name": "Swing Traders", "isFree": false } ]` sorted by name. An empty array means the member cannot raise a ticket yet (disable the form).

### `POST /attachments/presign`: get an upload link for one file

Request body:

```json
{ "fileName": "screenshot.png", "sizeBytes": 183422 }
```

Response `data`: `{ "uploadUrl": "https://…", "objectKey": "tickets/<userId>/<uuid>.png" }`.

Then **PUT the raw file bytes** to `uploadUrl` (not through the API, no auth cookie needed, no JSON). Set the `Content-Type` header to the file's real type. The link is valid for 5 minutes, so presign right before uploading, not when the form opens. Keep the returned `objectKey`: it is what you send with the ticket or message.

| Rule | Value |
|---|---|
| Allowed types | JPG / JPEG, PNG, WebP, PDF (the file name's extension is checked here) |
| Max size | 5 MB per file |
| Max count | 5 per ticket, and 5 per chat message |
| Real file check | When you submit, the server reads the file's first bytes. A renamed or fake file is rejected. |

Errors: `400 ATTACHMENT_INVALID` (extension not allowed), `422` (file larger than 5 MB).

A file you upload but never submit is cleaned up automatically after 24 hours, so there is no delete call.

### `POST /`: raise a ticket

Header (required): `Idempotency-Key: <uuid>`, 8 to 64 characters. **Generate a fresh one per form submission and reuse the same value if you retry that submission** (timeout, no network, double tap). A repeated key returns the original ticket and creates nothing new. Without the header you get `400 IDEMPOTENCY_KEY_REQUIRED`.

```json
{
  "communityId": "1c9f…",
  "category": "payments",
  "type": "issue",
  "subject": "Payment failed",
  "description": "Money deducted but no access",
  "attachments": [ { "objectKey": "tickets/<userId>/<uuid>.png", "fileName": "screenshot.png" } ]
}
```

| Field | Rules |
|---|---|
| `communityId` | Required, must be one from `GET /communities` |
| `category`, `type` | Required, values listed in section 4 |
| `subject` | Required, up to 150 characters (trimmed) |
| `description` | Required, up to 2000 characters (trimmed) |
| `attachments` | Optional, up to 5, no duplicate `objectKey` |

Response: **201** with the Ticket in `data` (status `open`). Show "Ticket submitted" and offer to open it.

Errors: `400 COMMUNITY_NOT_ALLOWED` (not one of the member's communities), `400 ATTACHMENT_INVALID` (a file is missing, over 5 MB, not an image/PDF, or not this member's upload; see section 7 for how to recover), `400 IDEMPOTENCY_KEY_REQUIRED`, `403 ACCOUNT_INACTIVE` (suspended or deleted account), `422` validation.

### `GET /`: my tickets

Query: `status` (`open`, `in_progress` or `resolved`; omit for all), `cursor`, `limit` (1 to 50, default 20). Sorted by `lastMessageAt` newest first.

Response `data`: `{ "items": [Ticket…], "nextCursor": "…" | null }`.

There is no counts endpoint yet, so filter chips cannot show totals like "Open (3)" unless you compute them from loaded pages.

### `GET /unread-count`: app badge

Response `data`: `{ "unreadCount": 3 }`, the total of unread admin replies across all of the member's tickets.

### `GET /:ticketId`

One Ticket. A ticket id that is not the member's, or not a valid id at all, returns **404** (never 403).

### `POST /:ticketId/rating`: rate a resolved ticket (once, final)

```json
{ "rating": 4, "comment": "Quick and helpful" }
```

`rating` is an integer 1 to 5. `comment` is optional, up to 1000 characters. Response: the updated Ticket.

Errors: `409 TICKET_NOT_RESOLVED` (not resolved yet), `409 ALREADY_RATED`.

### `GET /:ticketId/attachments/:attachmentId/url`

Response `data`: `{ "url": "https://…" }`, a fresh signed link. Use it when a link you were given earlier has expired.

## 6. The WebSocket

One socket per signed-in app session carries everything live. Open it when the user reaches the tickets area (or at app start if you want the badge live) and keep it open while the app is in the foreground.

### 6.1 Requests you send

Every request is a JSON **text** frame (binary frames are rejected):

```json
{ "id": "any-unique-string-up-to-64-chars", "action": "message.send", "payload": { … } }
```

The server answers with **exactly one** acknowledgement carrying the same `id`:

```json
{ "event": "ack", "id": "…", "ok": true,  "data": { … } }
{ "event": "ack", "id": "…", "ok": false, "error": { "code": "TICKET_RESOLVED", "message": "…" } }
```

Match acks to requests by `id`. Use a request timeout of about 15 seconds. The server handles frames from one connection **in the order sent**.

| `action` | `payload` | `data` on success |
|---|---|---|
| `message.send` | `{ "ticketId", "clientMessageId", "body"?, "attachments"? }` | the saved **Message** |
| `history.get` | `{ "ticketId", "before"?, "limit"? }` | `{ "items": [Message…], "nextCursor": "…" \| null }` |
| `ticket.read` | `{ "ticketId" }` | `{ "unreadCount": 0 }` |

**`message.send`**

- `clientMessageId`: required, 8 to 64 characters, a new UUID per message. **Reuse the same value when you retry the same message.** The server stores each `(ticket, clientMessageId)` once, so a retry returns the original message instead of posting twice. This makes it safe to resend after a timeout or a reconnect.
- `body`: up to 2000 characters, trimmed. `attachments`: up to 5 `{ "objectKey", "fileName" }`, uploaded as in section 5. A message needs text, at least one file, or both (otherwise `VALIDATION_ERROR`).
- A message to a resolved ticket is refused with `TICKET_RESOLVED`.

**`history.get`**: newest first. `limit` is 1 to 100 (default 30). For the first screen send no `before`. To load older messages send the `nextCursor` you got as `before`. Show messages oldest-to-newest on screen, so reverse each page.

**`ticket.read`**: call it when the member opens a ticket (and again if new admin messages arrive while they are looking at it). It sets that ticket's `unreadCount` to 0 and tells the member's other devices to do the same.

### 6.2 Events the server pushes

No `id`, and `event` is never `ack`:

```json
{ "event": "ticket.message", "ticketId": "…", "communityId": "…", "data": { … } }
```

| `event` | When | `data` |
|---|---|---|
| `ticket.created` | A ticket was raised, including from this member's **other device** | `{ "ticket": TicketSummary }` |
| `ticket.message` | A new message arrived on one of the member's tickets (admin reply, **and the member's own sends**) | `{ "message": Message, "ticket": TicketSummary }` |
| `ticket.updated` | An admin claimed, reassigned or resolved the ticket | `{ "ticket": TicketSummary }` |
| `ticket.read` | The member read the ticket on another device | `{ "unreadCount": 0 }` |

**TicketSummary** is a smaller version of Ticket, meant to be merged into your list row:

```json
{
  "id": "…", "number": 2041, "label": "FS-2041", "communityId": "…",
  "category": "payments", "type": "issue", "subject": "Payment failed",
  "status": "in_progress",
  "assignedAdmin": { "id": "…", "name": "Admin One" },
  "unreadCount": 2,
  "lastMessageAt": "2026-10-18T09:03:11.123Z",
  "rating": null,
  "resolvedAt": null
}
```

Two differences from the REST Ticket: the admin is an object `assignedAdmin` (or `null`), not `assignedAdminName`, and it has no `description`, attachments or rating comment. `unreadCount` is already **this member's** count. Update status, assignee, unread count, `lastMessageAt` and `rating` on the matching row, or refetch `GET /:ticketId` if you need a field it lacks.

**When `ticket.updated` means "resolved":** `status` is `resolved` and `resolvedAt` is set. If the member is on that conversation, lock the composer and show the rating sheet.

### 6.3 Rules your socket code must follow

1. **Your own message arrives twice**: once as the `ack` to `message.send`, and again as a `ticket.message` event (also on your other devices). The order is not guaranteed. De-duplicate by `message.id`.
2. **Optimistic UI**: show the message immediately as "sending" keyed by your `clientMessageId`. When the ack or the event arrives (the Message carries the same `clientMessageId`), replace it with the real message. On failure, leave it as "failed, tap to retry" and retry with the **same** `clientMessageId`.
3. **Nothing is replayed.** An event sent while the app was offline or disconnected is lost. After every (re)connect and every return to the foreground, refetch: the ticket list (or just the open ticket), `GET /unread-count`, and the open conversation's latest history page (merge by message `id`).
4. **Heartbeat**: the server sends a ping every 30 seconds and drops a connection that does not answer. Standard WebSocket libraries answer automatically; make sure yours does.
5. **Limits**: frames up to 64 KB, and at most 30 request frames per 10 seconds per connection (more returns `RATE_LIMITED`). Do not fire one `history.get` per row.
6. **Reconnect with backoff** (for example 1s, 2s, 4s, … capped at 30s), reset the delay after a successful connect, and pause while the app is in the background.
7. **Close code 4401 means "your session is no longer valid"**, not "try again". Do not just reconnect: check the session (`GET /api/v1/auth/mobile/me`). If it is 401, go to login. If it is fine, reconnect normally. The server also uses this when a pushed event is about to go to a session that has been logged out.

## 7. Flows, step by step

### Raise a ticket

1. Open the form: `GET /communities`. Disable submit if the list is empty.
2. For each file the member picks: check type and size locally (5 MB; JPG/PNG/WebP/PDF), `POST /attachments/presign`, PUT the bytes to `uploadUrl`, store `{ objectKey, fileName }`. Show per-file progress and let the member remove a file.
3. Generate an `Idempotency-Key` when the form is first shown. Disable the submit button while the request is in flight.
4. `POST /` with that key. On a network error or timeout, **retry with the same key**. On success, drop the key and show "Ticket submitted".
5. If you get `ATTACHMENT_INVALID`, the server does not say which file was bad (it deletes the bad one). Clear the attached files, tell the member "an attachment was invalid, please attach again", and have them re-add. The earlier uploads can no longer be reused safely.

### Open a ticket and chat

1. `GET /:ticketId` for the header (status, assigned admin name, rating).
2. Send `history.get` (no `before`) and render the **description as the first bubble**, then the messages oldest to newest.
3. Send `ticket.read` once the messages are on screen.
4. Subscribe to events for this `ticketId`: `ticket.message` appends (then send `ticket.read` again if the screen is in front), `ticket.updated` refreshes the header, status and composer.
5. Send with `message.send` as described above.
6. **Scrolling up**: when the member reaches the top, send `history.get` with `before` = the last `nextCursor`, and prepend the page. Hide the "load earlier" control when `nextCursor` is `null`.

### Resolved tickets

- A resolved ticket is **read-only for good**. Hide or disable the composer, and show something like "This ticket is resolved and the chat is closed." There is no reopen. (The design shows a "reopen" button that the backend does not support yet.)
- Show the rating sheet if `rating` is `null`. The rating can be given once; after that show it read-only.

### Attachment links

A signed `url` lasts about 5 minutes, so a long-open conversation can hold dead links. Whenever an image fails to load, or the member taps a file and the link may be stale, call `GET /:ticketId/attachments/:attachmentId/url` and use the fresh link (try that once per attachment, not in a loop). For images, render a thumbnail from `url`; for PDFs, open `url` in the system viewer or browser.

### Badge and list upkeep

- Total badge: `GET /unread-count` at app start and on foreground, then keep it correct from events: `ticket.message` from an admin raises it, `ticket.read` (from another device) and your own `ticket.read` lower it. Easiest and safest: refetch `GET /unread-count` after any of those events.
- List rows: merge each `TicketSummary` into the row with the same `id`, then move that row to the top (sort by `lastMessageAt`). A `ticket.created` for an unknown `id` becomes a new row at the top.

## 8. Errors you should handle

### REST

| HTTP | `code` | When | Suggested handling |
|---|---|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | `POST /` without the header | Bug in the app |
| 400 | `COMMUNITY_NOT_ALLOWED` | Community is not one of the member's | Refresh the community list |
| 400 | `ATTACHMENT_INVALID` | Bad file type, missing or oversize file | Ask to re-attach |
| 400 | `INVALID_CURSOR` | Cursor was altered | Restart from the first page |
| 401 | `SESSION_INVALIDATED` | Session ended or replaced | Go to login |
| 403 | `ACCOUNT_INACTIVE` | Account suspended or deleted | Show an account message |
| 403 | `MOBILE_ONLY` | Used a web login | Bug in the app |
| 404 | none | Ticket / attachment not found, not the member's, or an invalid id | Close the screen, refresh the list |
| 409 | `TICKET_NOT_RESOLVED`, `ALREADY_RATED` | Rating at the wrong time | Refresh the ticket |
| 422 | none (the body has an `errors` object) | Field problems, listed per field | Show field errors |
| 500 | none | Server fault | Generic retry message |

### Socket acks (`ok: false`)

| `error.code` | Meaning | Suggested handling |
|---|---|---|
| `TICKET_RESOLVED` | Ticket is resolved, chat is closed | Lock the composer, refresh the ticket |
| `HTTP_404` | Ticket not found or not the member's | Close the screen |
| `VALIDATION_ERROR` | Bad payload; `error.errors` has field messages | Show the problem (empty message, over 2000 characters, key too short) |
| `ATTACHMENT_INVALID` | Same as REST | Clear files, ask to re-attach |
| `INVALID_CURSOR` | Bad `before` | Reload the first page |
| `INVALID_FRAME` | Not valid JSON, unknown `action`, or no `id` | Bug in the app |
| `RATE_LIMITED` | More than 30 requests in 10 seconds | Back off, retry later |
| `AUTH_INVALID` | Session ended (the server then closes with 4401) | See rule 7 above |
| `INTERNAL_ERROR` | Server fault | Retry (safe for `message.send` with the same `clientMessageId`) |

Note: not-found acks use the code `HTTP_404` (the generic form), not `NOT_FOUND`.

## 9. Limits at a glance

| | |
|---|---|
| Subject | 150 characters |
| Ticket description | 2000 characters |
| Chat message | 2000 characters |
| Rating comment | 1000 characters |
| Files | 5 per ticket and 5 per message, 5 MB each, JPG / JPEG / PNG / WebP / PDF |
| Upload link lifetime | 5 minutes |
| Download link lifetime | about 5 minutes |
| Chat history page | 1 to 100 messages, default 30 |
| Ticket list page | 1 to 50, default 20 |
| Socket frame size | 64 KB |
| Socket request rate | 30 per 10 seconds per connection |
| Idempotency key / `clientMessageId` length | 8 to 64 characters |

## 10. Not available yet

Design items the backend does not support today, so do not build them against it:

- **Reopen** a resolved ticket.
- **Member-side close.** Only support resolves. The member's only closing action is the rating.
- **Push notifications and email** for new replies. A reply reaches the member only over an open socket, so the badge is stale until the app is opened or returns to the foreground, then refetch.
- **Per-status counts** for filter chips.
- **Status history** (when it moved to In Progress, who it was assigned to) in the member app. You receive the current status and the assigned admin's name only.
- **Deleting an uploaded file** you have not submitted.

## 11. Test checklist

Run these before release, on a real device and a real network (the socket has only been exercised against a local test server so far):

1. Raise a ticket with no files; with 5 files; with a 6th file (blocked in the app); with a file over 5 MB (blocked in the app).
2. Double-tap submit, and kill the network right after tapping submit then retry: exactly **one** ticket exists.
3. Rename a `.txt` to `.png` and submit: `ATTACHMENT_INVALID`, the app recovers cleanly.
4. Send a chat message, then toggle airplane mode during the send and retry: one message, no duplicate bubble.
5. Admin replies while the app is open on the conversation: the message appears live and the unread count stays at 0.
6. Admin replies while the app is on the ticket list: the row jumps to the top with the unread dot, the app badge increases.
7. Open the same account on two devices: a ticket raised, a message sent and a read on one device show on the other.
8. Background the app for a few minutes, then return: the list, badge and open conversation refresh.
9. Admin resolves while the member is in the chat: the composer locks and the rating sheet appears. Rate once; a second attempt is blocked.
10. Log out on another device, or let the session end: the socket closes with 4401 and the app goes to login instead of reconnecting forever.
11. Keep a conversation open longer than 5 minutes with images, then scroll: expired images reload through the attachment-url call.
12. Scroll to the top of a long conversation: older pages load with no gaps and no duplicates.
