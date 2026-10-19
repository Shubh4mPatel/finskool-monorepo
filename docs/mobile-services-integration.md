# Services: Mobile Integration Guide

For the mobile developer integrating the **services** feature into the member app. A member picks a service, chats with the support team about what they need, receives a **quote**, pays it through Razorpay, and later rates the service after the team has delivered it and closed the request. The service itself is delivered outside the app.

This guide covers the REST endpoints, the chat and live events over the WebSocket, and the payment flow in detail. It reuses the same login, cookie and socket as the support-ticket feature: read [`mobile-tickets-integration.md`](./mobile-tickets-integration.md) for the shared basics (sections 2, 3 and 6.3 there), which are summarised here but not repeated in full. For the design and the admin side, see [`services-module-plan.md`](./services-module-plan.md).

Written against branch `feat/services-module` (2026-10-19). If something here disagrees with the backend, the backend wins: please tell us.

## 1. The journey in one picture

| Step | Who | What happens | Request `status` |
|---|---|---|---|
| 1 | Member | Browses the **catalog** and requests a service, describing what they need | `requested` |
| 2 | Both | Chat. The admin agrees the scope with the member | `requested` |
| 3 | Admin | Sends a **quote** (a card in the chat). A newer quote replaces the older one, which shows as disabled | `quote_sent` |
| 4 | Member | Taps **Pay** on the quote, confirms billing details, pays in Razorpay Checkout | `quote_sent` |
| 5 | Backend | Payment confirmed (by your verify call **or** Razorpay's webhook). A GST invoice is created | `paid` |
| 6 | Admin | Delivers the service outside the app and closes the request | `closed` (`completed`) |
| 7 | Member | Rates the service, once | `closed` |

Other endings: the member can **cancel** before paying, the admin can **decline**, and a quote that is not paid in time **expires** and the request goes back to `requested` for a new quote.

| Screen | What it needs |
|---|---|
| **Service catalog** | `GET /catalog` |
| **Request a service** (form) | upload files, `POST /` |
| **My requests** (list + badge) | `GET /`, `GET /unread-count`, live events |
| **Request detail / chat** | `GET /:id`, then the socket for history, send and read |
| **Pay** (billing sheet + Razorpay) | `GET /gst-states`, `POST /:id/quotes/:quoteId/pay`, `POST /:id/payments/verify` |
| **Invoice** | `GET /:id/invoice` |
| **Rating sheet** | `POST /:id/rating` |

**Chat is over the WebSocket only** (there are no REST chat endpoints), exactly as for tickets.

## 2. Conventions (same as tickets)

| | |
|---|---|
| REST base | `https://<api-host>/api/v1/mobile/services` (every path below is relative to this) |
| Socket URL | `wss://<api-host>/ws/tickets`. The **same** connection carries ticket and service traffic, so keep one socket for both |
| Auth | The `mobile_session_id` cookie, on REST **and** on the WebSocket upgrade request |
| Success body | `{ "success": true, "data": … }` |
| Error body | `{ "success": false, "message": "…", "code": "SOME_CODE" }` (`code` is not always present) |
| Validation error (HTTP 422) | `{ "success": false, "message": "Validation failed", "errors": { "needs": ["…"] } }`. Errors inside the `billing` object come under the single key `billing` |
| Ids | UUID strings. Timestamps are ISO 8601 in UTC |
| Money | **Rupees as numbers with two decimals** in every DTO (`11800`, `1382.71`). The one exception is the payment order from `/pay`, whose `amount` is in **paise**, as Razorpay requires |
| Label | Show `label` (`SR-12`) for a request, never `number` or `id` |
| Pagination | Cursor based: pass the `nextCursor` you were given as `cursor` (REST) or `before` (chat history); `null` means no more |

A web (dashboard) login gets 403 `MOBILE_ONLY`; an ended session gets 401 `SESSION_INVALIDATED` (go to login). Socket rules (heartbeat, 64 KB frames, 30 requests per 10 seconds, close code 4401 = re-authenticate, nothing is replayed after a disconnect) are the same as in the tickets guide: **those requests are counted per connection across tickets and services together**.

## 3. Data shapes

### Service (catalog entry)

```json
{ "id": "7c3e…", "title": "Portfolio Management", "description": "We manage your portfolio…", "imageUrl": "https://…/services/….png" }
```

`imageUrl` may be `null`. Only active services are returned.

### Service request

```json
{
  "id": "47d4…",
  "number": 12,
  "label": "SR-12",
  "status": "quote_sent",
  "closedReason": null,
  "needs": "Please manage my 5 lakh portfolio, mostly large caps.",
  "attachments": [],
  "lastMessageAt": "2026-10-19T07:04:11.123Z",
  "paidAt": null,
  "closedAt": null,
  "rating": null,
  "ratingComment": null,
  "ratedAt": null,
  "createdAt": "2026-10-19T07:03:02.411Z",
  "service": { "id": "7c3e…", "title": "Portfolio Management", "imageUrl": null },
  "assignedAdminName": "Admin One",
  "unreadCount": 2,
  "quote": { /* see Quote, or null */ },
  "invoice": null
}
```

| Field | Notes |
|---|---|
| `status` | `requested` (waiting for a quote), `quote_sent` (a quote can be paid), `paid` (being delivered), `closed` (final) |
| `closedReason` | When `closed`: `completed` (delivered), `declined` (the team turned it down) or `cancelled_by_member` |
| `needs` / `attachments` | What the member asked for. Show it as the **first message** of the conversation yourself; it is not in the message history |
| `assignedAdminName` | `null` until an admin takes it |
| `unreadCount` | Unread replies for this request |
| `quote` | The payable quote (`status: "active"`), or the paid one after payment. `null` when there is no quote right now (never quoted, expired and swept, withdrawn, replaced and none active) |
| `invoice` | `{ id, number, issuedAt, total }` once paid, else `null` |

### Quote

```json
{
  "id": "6cfc…", "requestId": "47d4…", "version": 2,
  "baseAmount": 12000, "gstRatePercent": 18, "gstAmount": 2160, "totalAmount": 14160,
  "currency": "INR",
  "note": "Monthly management fee, billed upfront.",
  "expiresAt": "2026-10-24T07:04:11.000Z",
  "status": "active",
  "createdAt": "2026-10-19T07:04:11.000Z"
}
```

| `status` | Meaning | Show |
|---|---|---|
| `active` | Can be paid until `expiresAt` | Pay button and a countdown |
| `paid` | Paid | "Paid" |
| `superseded` | The admin sent a newer quote | Greyed out and disabled, label **"Replaced by a newer quote"** |
| `expired` | Past `expiresAt` | Greyed out, "Expired" |
| `cancelled` | Withdrawn (the request was cancelled or declined) | Greyed out, "Withdrawn" |

The status is **always current**: a quote past its expiry already reads `expired` even before the server's clean-up runs, so you do not need to compare dates yourself (but a countdown on an active quote is a nice touch). `totalAmount = baseAmount + gstAmount`, and **the total is what the member pays**. Show the breakdown: service fee, GST at the given rate, total.

### Message

```json
{
  "id": "…", "requestId": "…",
  "senderId": "…" , "senderRole": "admin", "senderName": "Admin One",
  "kind": "text",
  "body": "Yes, happy to. Sending you a quote shortly.",
  "quote": null,
  "clientMessageId": "…",
  "attachments": [],
  "createdAt": "…"
}
```

| `kind` | `senderRole` | How to draw it |
|---|---|---|
| `text` | `user` (the member = "me") or `admin` | A normal bubble. `body` is `null` for a file-only message |
| `quote` | `admin` | **A quote card** built from `message.quote` (its `status` is current). `body` is `null` |
| `system` | `system` (`senderId` is `null`, `senderName` is "Finskool") | A centred notice, not a bubble. Examples: "Payment received. Thank you!", "This quote has expired…", "We received a payment that could not be matched…" |

## 4. REST endpoints

### `GET /catalog`

Active services. Response `data`: `Service[]`, sorted by title.

### `POST /attachments/presign`

Exactly as for tickets: body `{ "fileName", "sizeBytes" }`, response `{ "uploadUrl", "objectKey" }`; PUT the raw bytes to `uploadUrl` (valid 5 minutes), then send `{ objectKey, fileName }` with the request or the message. JPG / PNG / WebP / PDF, 5 MB each, up to 5 per request and per message. A file you upload but never send is cleaned up automatically after 24 hours.

### `POST /`: request a service

Header **`Idempotency-Key: <uuid>`** (8 to 64 characters) is required: create one per form submission and **reuse it on a retry**; a repeated key returns the original request.

```json
{ "serviceId": "7c3e…", "needs": "Please manage my 5 lakh portfolio…", "attachments": [ { "objectKey": "services/<userId>/<uuid>.pdf", "fileName": "holdings.pdf" } ] }
```

`needs` is required (1 to 2000 characters). Response **201** with the request (`status: "requested"`).

| Error | When |
|---|---|
| 400 `IDEMPOTENCY_KEY_REQUIRED` | Header missing |
| 400 `ATTACHMENT_INVALID` | A file is missing, over 5 MB, not an image / PDF, or not this member's upload. The server does not say which file; clear the attachments and ask the member to add them again |
| 403 `ACCOUNT_INACTIVE` | Suspended or deleted account |
| 404 | The service does not exist or is no longer active |
| 409 `SERVICE_REQUEST_ALREADY_OPEN` | The member already has an open request for this service. A request stays open until it is `closed`, **including after it is paid** while the team is delivering. Send them to that request instead |
| 422 | `needs` empty or too long |

### `GET /`: my requests

Query: `status` (`requested`, `quote_sent`, `paid`, `closed`), `cursor`, `limit` (1 to 50, default 20). Sorted by `lastMessageAt`, newest first. Response `data`: `{ "items": Request[], "nextCursor": "…" | null }`.

### `GET /unread-count`

`data`: `{ "unreadCount": 3 }`, the total of unread replies across all requests (app badge).

### `GET /:requestId`

One request. Anything that is not the member's, or not a valid id, returns **404**.

### `POST /:requestId/cancel`

The member backs out **before paying**. Response: the request, now `closed` with `closedReason: "cancelled_by_member"`; any quote waiting for payment becomes `cancelled`.
Errors: `409 SERVICE_CLOSED`, `409 SERVICE_NOT_CANCELLABLE` (already paid: only the team closes it now).

### `GET /gst-states`

`data`: `[ { "code": "27", "name": "Maharashtra" }, … ]`: every Indian state / UT with its GST code. Feeds the state picker on the billing sheet.

### `POST /:requestId/quotes/:quoteId/pay`: start a payment

Call when the member taps **Pay** on a quote card **and has confirmed their billing details** (they appear on the GST invoice):

```json
{ "billing": { "name": "Member One", "stateCode": "27", "gstin": "29AABCT1332L1ZA", "address": "12 MG Road, Bengaluru" } }
```

| Field | Rules |
|---|---|
| `name` | Required, up to 150 characters. Pre-fill from their profile |
| `stateCode` | Required, one of the codes from `/gst-states`. It decides whether the invoice splits the tax into CGST + SGST or shows IGST; the **total never changes** |
| `gstin` | Optional, for an invoice in a business name. 15 characters, valid GSTIN, and its first two digits must equal `stateCode` |
| `address` | Optional, up to 300 characters |

Response `data` is exactly what Razorpay Checkout needs:

```json
{ "orderId": "order_Q3x…", "amount": 1416000, "currency": "INR", "keyId": "rzp_live_…", "quoteId": "6cfc…", "requestId": "47d4…" }
```

`amount` is **in paise** and already includes GST. Calling `/pay` again for the same quote returns the **same order**, so double taps and retries are safe.

| Error | When | Suggested handling |
|---|---|---|
| 404 | Quote or request not found / not the member's | Close the sheet, refresh the request |
| 409 `QUOTE_EXPIRED` | The quote is past its expiry | "This quote has expired. Ask for a new one." |
| 409 `QUOTE_NOT_PAYABLE` | Replaced, withdrawn, or the request is not awaiting payment | Refresh the request; the card will show why |
| 409 `SERVICE_ALREADY_PAID` | Already paid | Refresh the request |
| 409 `SERVICE_CLOSED` | The request is closed | Refresh the request |
| 409 `BILLING_NOT_CONFIGURED` | The business has not finished its billing set-up | "Payments aren't available yet. Please try later." (tell us) |
| 422 | Billing details invalid; messages under `errors.billing` | Show the message next to the field |
| 502 `PAYMENT_GATEWAY_ERROR` | Razorpay could not create the order | "Couldn't start the payment. Please try again." |
| 503 `PAYMENTS_NOT_CONFIGURED` | Payments are switched off on the server | "Payments aren't available right now." |

### `POST /:requestId/payments/verify`: confirm after Checkout

Send the three values Razorpay Checkout returns on success:

```json
{ "razorpayOrderId": "order_Q3x…", "razorpayPaymentId": "pay_Q3y…", "razorpaySignature": "9f2c…" }
```

Response: the **request**, now `status: "paid"` with its `invoice`. It is **safe to call more than once**, and safe when Razorpay's webhook already confirmed the payment: you always get the current request back. Errors: `400 PAYMENT_SIGNATURE_INVALID` (the signature did not match: do not treat the payment as done), `404` (order not found / not yours).

### `GET /:requestId/invoice`

`data`: `{ "url": "https://…", "fileName": "FS-2026-27-0001.pdf" }`, a short-lived signed link to the GST invoice PDF. Open it in the system PDF viewer or share sheet. `404` until the request is paid. The PDF is created on demand, so the very first call right after payment can take a moment. **The invoice is also emailed** to the member if they have an email address on their account.

### `POST /:requestId/rating`

`{ "rating": 1-5, "comment"?: "up to 1000 characters" }`, **once**, and only after the request is `closed` with `closedReason: "completed"`. Response: the updated request.
Errors: `409 SERVICE_NOT_COMPLETED`, `409 ALREADY_RATED`, `422`.

### `GET /:requestId/attachments/:attachmentId/url`

`data`: `{ "url" }`, a fresh signed link when an earlier one (valid about 5 minutes) has expired.

## 5. The WebSocket

Same endpoint, authentication and frame format as tickets: `{ "id", "action", "payload" }` answered by exactly one `{ "event": "ack", "id", "ok", "data" | "error" }`.

| `action` | `payload` | `data` |
|---|---|---|
| `service.message.send` | `{ "requestId", "clientMessageId", "body"?, "attachments"? }` | the saved **Message** |
| `service.history.get` | `{ "requestId", "before"?, "limit"? }` | `{ "items": Message[], "nextCursor" }` |
| `service.read` | `{ "requestId" }` | `{ "unreadCount": 0 }` |

- `clientMessageId`: 8 to 64 characters, new for each message and **reused on a retry** (the server posts a message once per id and returns the original on a repeat).
- Body up to 2000 characters, up to 5 attachments, text or files or both.
- `service.history.get`: newest first, `limit` 1 to 100 (default 30). Quote cards and system messages are part of the history, so a quote's current `status` comes with it.
- A message to a **closed** request is refused with `SERVICE_CLOSED`. A retry of a message that was already stored still returns it, even if the request closed in the meantime.
- Call `service.read` when the conversation is on screen and again when new admin messages arrive while the member is looking.

### Events you receive (no `id`, `event` is not `ack`)

```json
{ "event": "service.message", "requestId": "…", "data": { "message": Message, "request": Summary, "supersededQuoteId": "…" | null } }
```

| `event` | When | `data` |
|---|---|---|
| `service.created` | A request was raised, including from this member's other device | `{ "request": Summary }` |
| `service.message` | A new message arrived: an admin reply, **a new quote card, a system notice** (payment received, quote expired, payment under review), and the member's own sends | `{ "message", "request": Summary, "supersededQuoteId"? }` |
| `service.updated` | Status changed: an admin took it, reassigned it, closed it; the quote changed; payment confirmed; the member's rating | `{ "request": Summary }` |
| `service.read` | The member read the request on another device | `{ "unreadCount": 0 }` |

**Summary** is a smaller request meant to be merged into a list row:

```json
{
  "id": "…", "number": 12, "label": "SR-12",
  "serviceId": "…", "serviceTitle": "Portfolio Management",
  "status": "paid", "closedReason": null,
  "assignedAdmin": { "id": "…", "name": "Admin One" },
  "unreadCount": 1,
  "lastMessageAt": "…", "rating": null, "paidAt": "…", "closedAt": null,
  "quote": { /* Quote or null */ },
  "invoiceNumber": "FS/2026-27/0001",
  "requiresReview": false
}
```

Differences from the REST request: the admin is an object `assignedAdmin`, there is `invoiceNumber` instead of the `invoice` object, and there is no `needs`, attachments or rating comment. `unreadCount` is already this member's. Ignore `requiresReview` (it is for the support team). To get a field the summary lacks (for example the invoice id), refetch `GET /:id`.

**Rules specific to quotes and payments:**

1. When a `service.message` with `kind: "quote"` arrives, add the card **and disable every older quote card** in the open chat. `supersededQuoteId` names the one it replaced; if you only match on that id you are safe even if other cards are on screen.
2. A `service.updated` with `status: "paid"` means the payment is confirmed (by your verify call or by Razorpay's webhook). If the member is on the conversation, update the header, hide the Pay button and show the invoice entry.
3. After the request is `closed` with `closedReason: "completed"` and `rating: null`, offer the rating sheet.
4. The same socket rules as tickets apply: your own message arrives twice (ack and event, in either order; dedupe by message `id`), nothing is replayed after a disconnect (refetch the list, the badge and the open request, and merge history by id), reconnect with backoff, and **close code 4401 means "session no longer valid"**, so check the session instead of reconnecting blindly.

## 6. The payment flow, step by step

```
Member taps Pay on an active quote card
  1. Show the billing sheet (name, state, optional GSTIN / address)         GET /gst-states
  2. POST /:id/quotes/:quoteId/pay  { billing }   ->  { orderId, amount (paise), keyId, … }
  3. Open Razorpay Checkout with key = keyId, order_id = orderId
  4a. Success -> Checkout gives { payment id, order id, signature }
        POST /:id/payments/verify  ->  request, status "paid", with invoice
  4b. Failure or the member closes the sheet -> nothing to confirm; the card is still payable
  5. App killed / offline after paying?  Razorpay's webhook confirms it on the server.
        On the next launch refetch the request: it will already be "paid".
```

- **Razorpay Checkout:** use the Razorpay SDK for your stack (Android, iOS, Flutter and React Native are all supported). Always pass the **`order_id` from `/pay`**: Razorpay requires an order created by our server, and the order is what fixes the amount. Use `keyId` as the key. Pre-fill the member's name, phone and email if you have them. Do not build your own amount.
- **Trust the server, not Checkout.** A "success" callback means the member paid, but the request only becomes `paid` once `/verify` (or the webhook) has run. Show a short "Confirming your payment…" state after Checkout returns and wait for the verify response. If `/verify` fails with a network error, **retry it** (it is idempotent); if it keeps failing, refetch `GET /:id` or wait for the `service.updated` event, because the webhook will normally have confirmed it already.
- **Never call `/verify` without a real signature** and never mark a request paid from the client's own state.
- **Expiry.** A quote is payable until `expiresAt` (5 days by default; the admin can change it per quote). Once the member has opened the payment sheet, the server holds off expiring or replacing that quote for 15 minutes, but an admin can still replace it after confirming a warning. If the member pays a quote that was replaced or expired in the meantime, the money is **not lost**: the support team is alerted and pays it back; the member sees a system message "We received a payment that could not be matched to your current quote. Our team will review it and be in touch." Show it like any system notice.
- **Retries and double taps.** `/pay` returns the same order for the same quote while it is unpaid, and `/verify` can be called repeatedly, so you do not need client-side de-duplication beyond disabling the button while a call is in flight.
- **Receipt.** After payment show the invoice number from `request.invoice` and a "Download invoice" action calling `GET /:id/invoice`.
- **Refunds** are not part of the app: the support team handles them in the Razorpay dashboard.

## 7. Flows, step by step

### Request a service

1. `GET /catalog` to list services.
2. Show the description and a **Request** action. If the member already has an open request for it, the API answers 409 `SERVICE_REQUEST_ALREADY_OPEN`: take them to their existing request (from `GET /` filtered client-side by `service.id` and `status != "closed"`).
3. Form: a description of what they need (required) and optional files (presign, PUT, keep `objectKey`). Create an `Idempotency-Key` when the form opens; disable the submit button while the call is in flight.
4. `POST /` with that key. On a network error, retry with the **same** key.

### Open a request and chat

1. `GET /:id` for the header (status, assigned admin, quote).
2. `service.history.get` (no `before`), then draw: the member's `needs` as the first bubble, then messages oldest to newest (reverse each page), with quote cards and system notices as described.
3. `service.read` when the messages are on screen.
4. Listen for events for this `requestId` and update as in section 5.
5. Send with `service.message.send`, with an optimistic bubble keyed by `clientMessageId` (same approach as tickets).
6. Scrolling up: `service.history.get` with `before` = the last `nextCursor`; hide "load earlier" when it is `null`.

### What the header and composer should show

| `status` | Header | Composer | Actions |
|---|---|---|---|
| `requested` | "Waiting for a quote" | Open | **Cancel request** |
| `quote_sent` | "Quote received" and the amount | Open | **Pay** on the active quote card; **Cancel request** |
| `paid` | "Paid. In progress" with the invoice | Open | **Download invoice** |
| `closed` + `completed` | "Completed" | Locked ("This request is closed") | **Rate** if not rated yet; **Download invoice** |
| `closed` + `declined` | "Declined" | Locked | none |
| `closed` + `cancelled_by_member` | "Cancelled" | Locked | none |

### Badge and list upkeep

`GET /unread-count` at app start and on foreground, refetch it after any `service.message` / `service.read` event. For list rows, merge each `Summary` into the row with the same `id` and move it to the top (sort by `lastMessageAt`); a `service.created` for an unknown id adds a new row at the top.

## 8. Errors at a glance

| Code | HTTP / where | Meaning |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Missing `Idempotency-Key` on `POST /` |
| `ATTACHMENT_INVALID` | 400, ack | A file was rejected; clear files and re-add |
| `INVALID_CURSOR` | 400, ack | Bad cursor; restart from the first page |
| `PAYMENT_SIGNATURE_INVALID` | 400 | Verify signature did not match |
| `SESSION_INVALIDATED` | 401 | Session ended; go to login |
| `ACCOUNT_INACTIVE` | 403 | Account suspended or deleted |
| `MOBILE_ONLY` | 403 | Called with a web login |
| (none) / `HTTP_404` in acks | 404 | Not found or not the member's |
| `SERVICE_REQUEST_ALREADY_OPEN` | 409 | Open request for that service exists |
| `SERVICE_CLOSED` | 409, ack | The request is closed |
| `SERVICE_NOT_CANCELLABLE` | 409 | Already paid |
| `SERVICE_ALREADY_PAID` | 409 | Already paid (pay) |
| `QUOTE_EXPIRED` | 409 | Quote past its expiry |
| `QUOTE_NOT_PAYABLE` | 409 | Quote replaced / withdrawn, or nothing to pay |
| `BILLING_NOT_CONFIGURED` | 409 | Business billing not set up yet |
| `SERVICE_NOT_COMPLETED` | 409 | Rating before the service is completed |
| `ALREADY_RATED` | 409 | Rated already |
| `VALIDATION_ERROR` / 422 | 422, ack | Field problems; see `errors` |
| `RATE_LIMITED`, `INVALID_FRAME`, `AUTH_INVALID`, `INTERNAL_ERROR` | ack | Socket-level, as in the tickets guide |
| `PAYMENT_GATEWAY_ERROR` | 502 | Razorpay order could not be created |
| `PAYMENTS_NOT_CONFIGURED` | 503 | Payments off on the server |

## 9. Limits

| | |
|---|---|
| Request description (`needs`) | 2000 characters |
| Chat message | 2000 characters |
| Rating comment | 1000 characters |
| Billing: name / address | 150 / 300 characters |
| Files | 5 per request and per message, 5 MB each, JPG / PNG / WebP / PDF |
| Upload / download links | 5 minutes |
| Quote validity | 5 days by default (set by the admin per quote) |
| Payment "in progress" protection | 15 minutes after the member opens the payment sheet |
| History page | 1 to 100 messages, default 30 |
| Request list page | 1 to 50, default 20 |

## 10. Not available yet

- **Push notifications and email** for new messages or quotes. Replies and quotes reach the member over an open socket only, so refetch on launch and foreground.
- **Refunds in the app** and any payment methods outside Razorpay.
- **Status history** for the member (only the current status, the assigned admin's name and the closing reason).
- **Reopening** a closed request, or deleting an uploaded file.
- **Paying a quote part by part.** A quote is paid in full, once.

## 11. Test checklist

Use Razorpay **test mode** keys on the staging server for the payment items.

1. Browse the catalog; request a service with and without files; double-tap submit and retry after dropping the network (one request only); try to request the same service again (409 and the member is taken to the open one).
2. Admin sends a quote: the card appears live with the amounts, GST and note; the badge goes up.
3. Admin sends a **revised** quote while the chat is open: the old card turns grey with "Replaced by a newer quote" and cannot be tapped.
4. Pay a quote: billing sheet validation (state required, a GSTIN of the wrong state is rejected), Checkout opens with the right amount, success then "Confirming…" then **paid** with an invoice number.
5. Pay, then **kill the app before verify** (or turn off the network): reopen it and the request is already `paid` (webhook fallback).
6. Close the Checkout sheet without paying and tap Pay again: the same order is used, no error.
7. Let a quote expire (ask the admin to set a 1 day expiry and change the server clock, or use a short expiry on staging): the card shows "Expired", Pay is rejected with `QUOTE_EXPIRED`, the request is back to `requested`.
8. Admin replaces a quote while the member has the payment sheet open and the member then pays: the member sees the "payment under review" notice and the support team is alerted.
9. Cancel a request before paying (the quote card is withdrawn); try to cancel after paying (blocked).
10. Download the invoice (PDF opens; it shows the right GST split for the member's state) and check the invoice email arrives.
11. Admin closes as completed: the composer locks, the rating sheet appears, a second rating is blocked.
12. Two devices on one account: a request, a message and a read on one show on the other.
13. Background the app for a while, then return: the list, badge, open conversation and quote status are refreshed.
14. Log out elsewhere: the socket closes with 4401 and the app goes to login.
