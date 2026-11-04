# Community Payment: Mobile Integration Guide

For the mobile developer building the **"buy a community"** flow in the member app. A member browses the paid communities, picks a plan (for example "3 Month"), pays through Razorpay, and gets access to the community right away.

This guide is based on the backend code (`apps/backend/src/modules/payments`, `GET /mobile/communities` in `app.ts`, the Razorpay webhook, and the webview page in `apps/frontend/src/app/pay/checkout`). If something here disagrees with the backend, the backend wins: please tell us.

All paths below are under `/api/v1`.

## 1. The journey in one picture

| Step | Who | What happens |
|---|---|---|
| 1 | App | Shows the paid communities and their plans (`GET /mobile/communities`) |
| 2 | Member | Taps **Buy** on a plan |
| 3 | App | Asks the backend for a checkout (`POST /payments/checkout-sessions`) and gets a `checkoutUrl` |
| 4 | App | Opens `checkoutUrl` in a **webview** |
| 5 | Webview page | Shows the community, plan and total (with the GST), and opens Razorpay Checkout when the member taps **Pay** |
| 6 | Member | Pays (UPI, card, netbanking, wallet) inside Razorpay |
| 7 | Backend | Confirms the payment and gives the member access. Either the page's verify call does it **or** Razorpay's webhook does, whichever arrives first |
| 8 | Webview page | Tells the app `paid` (a `postMessage`) |
| 9 | App | Closes the webview and re-reads the member's communities (`GET /auth/mobile/me`) |

**The app never touches Razorpay or the payment signature.** The webview page does all of that. The app only starts the checkout, shows the webview, and confirms the result with the backend afterwards.

| Screen | What it needs |
|---|---|
| **Community list / paywall** | `GET /mobile/communities` |
| **Plan picker** | the `plans` array from the same call |
| **Pay (webview)** | `POST /payments/checkout-sessions`, then open the URL |
| **After payment** | `GET /auth/mobile/me`, a notification, and `GET /mobile/posts?communityId=` |

## 2. Basics you need first

### 2.1 Login and the session cookie

Every call the app makes needs the member to be logged in with the **mobile login** (`POST /auth/mobile/login`). The backend sets an httpOnly cookie named `mobile_session_id`. Your HTTP client must keep that cookie and send it on every request (a cookie jar). There is no token in the response body.

- A call without the cookie gets `401` `Not authenticated`.
- A call with a cookie that is no longer valid (logged in on another device, logged out, account disabled) gets `401` with `code: "SESSION_INVALIDATED"`. Send the member back to login.
- The payment endpoints that start a checkout are **mobile only**. A web login is refused with `403` and `code: "MOBILE_ONLY"`.

### 2.2 Response shape

Success:

```json
{ "success": true, "data": { } }
```

Error:

```json
{ "success": false, "message": "Human readable text", "code": "OPTIONAL_CODE" }
```

`code` is only present for some errors. Use `message` to show the member something and `code` for logic.

### 2.3 Money

- Prices on the plan list are **rupees**. `price` is what the plan costs **before GST**; **GST is added on top**, so what the member pays is `totalAmount` (see "GST" below).
- The checkout order uses **paise** (`amount: 117882`), and that is the **total, GST included**. The server decides the amount from the plan. The app can never set it.
- Currency is always `INR`. A plan whose total is below ₹1 cannot be bought.

**GST.** A plan's `price` does not include GST. The server adds GST on top (18% by default, set by the admin in Settings > Billing) and Razorpay charges the total. Every plan in a response carries the split, so the app shows:

| Field | Meaning | Example |
|---|---|---|
| `price` | The plan's price before GST | `999` |
| `gstRatePercent` | The GST rate added on top | `18` |
| `gstAmount` | The GST in rupees | `179.82` |
| `totalAmount` | What the member pays | `1178.82` |

**Show `totalAmount` as the amount to pay** (for example "₹1,178.82", with "₹999 + ₹179.82 GST (18%)" beneath it). If you show `price` alone the member is shown less than Razorpay charges. While the admin's billing details are incomplete no GST is added, and then `gstRatePercent` and `gstAmount` are `0` and `totalAmount` equals `price`, so the same code works either way. Do not work the GST out in the app: use the fields.

## 3. Step 1: show the communities and plans

### `GET /mobile/communities`

Mobile only. Returns every paid community (the one free community is never listed, because it has no plans and every member is already in it).

```json
{
  "success": true,
  "data": [
    {
      "id": "6f0c…-uuid",
      "name": "Swing Trading Club",
      "slug": "swing-trading-club",
      "description": "…",
      "tags": ["stocks"],
      "type": "Short Term Investment",
      "coverImageUrl": "https://…",
      "badgeUrl": "https://…",
      "whatsIncluded": ["Daily trade ideas", "Live Q&A"],
      "subscribedMemberCount": 128,
      "plans": [
        { "id": "a1b2…-uuid", "name": "1 Month", "durationMonths": 1, "price": 399, "gstRatePercent": 18, "gstAmount": 71.82, "totalAmount": 470.82 },
        { "id": "c3d4…-uuid", "name": "3 Month", "durationMonths": 3, "price": 999, "gstRatePercent": 18, "gstAmount": 179.82, "totalAmount": 1178.82 }
      ]
    }
  ]
}
```

- Communities are sorted by name. `plans` are sorted by `durationMonths`, cheapest duration first.
- Only active plans appear. A plan an admin switched off is not in the list.
- A community can have an empty `plans` array. Do not show a Buy button then.
- This list does **not** say whether the member already owns a community. Get that from `GET /auth/mobile/me` (section 6) and decide in the app whether the button says **Buy** or **Renew**.

There is also `GET /communities/:communityId/plans` that returns just the plans of one community (`[{ id, name, durationMonths, price, gstRatePercent, gstAmount, totalAmount }]`). You do not need it if you use the list above. It returns `404` for an unknown or deleted community and an empty array for the free community.

## 4. Step 2: start the checkout

### `POST /payments/checkout-sessions`

Mobile only (session cookie). Call this when the member taps Buy on a plan.

Request:

```json
{ "communityId": "6f0c…-uuid", "planId": "c3d4…-uuid" }
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://community.finskool21.in/pay/checkout#t=Zk3…",
    "expiresInSeconds": 120
  }
}
```

What the backend does for you:

- Creates the Razorpay order for the plan's price (or **reuses** the member's unpaid order for the same plan made in the last 15 minutes, so repeated taps do not pile up orders).
- Makes a **one-time token** and puts it after the `#` in the URL.

Rules to follow in the app:

- **Open `checkoutUrl` exactly as returned**, immediately. Do not strip, encode or rebuild it. The token is only valid for `expiresInSeconds` (120 seconds by default) and works **once**.
- **Never log or store the URL.** The token is the credential.
- **Never reload the webview.** The page removes the token from the address bar as soon as it loads. A reload has no token and shows "This payment link is not valid". To try again, call this endpoint again (it reuses the unpaid order, so no new Razorpay order is created).
- **Do not send the session cookie to the webview.** The page does not need it, and the whole design keeps the app's session away from the page. Use a webview that does not share your API cookie jar, or at least do not inject the cookie.

Errors:

| Status | `code` | When | What to do |
|---|---|---|---|
| 400 | | Body is missing, or `communityId`/`planId` is not a UUID | Bug in the app |
| 400 | | The community is the free community | Do not offer Buy for it |
| 400 | | The plan is priced below ₹1 | Show "This plan cannot be bought right now" |
| 401 | `SESSION_INVALIDATED` / none | Not logged in | Go to login |
| 403 | `MOBILE_ONLY` | Called with a web login | Use the mobile login |
| 404 | | Community or plan not found, deleted, switched off, or the plan belongs to another community | Refresh the list |
| 429 | | More than **10 checkout starts per hour** for this member | Show "Too many attempts, try again later". Failed attempts count too |
| 500 | | Razorpay is not configured or unreachable | Show a generic error, let them retry |

## 5. Step 3: show the webview

Open `checkoutUrl` in an in-app webview (React Native: `react-native-webview`; native Android or iOS: a `WebView` / `WKWebView`). JavaScript and DOM storage must be **enabled**, because the page loads Razorpay's script from `checkout.razorpay.com`.

The page itself:

1. Reads the token from the URL, removes it from the address bar and history.
2. Trades it for the order details (`POST /payments/checkout/exchange`, see section 7).
3. Shows the community name, plan name and price with a **Pay** button.
4. Opens Razorpay Checkout when tapped, then confirms the payment with the backend.
5. Shows "Payment successful, you can go back to the app now".

The page never closes itself. **The app closes the webview** (see 5.2).

### 5.1 Webview settings checklist

- Allow navigation to `checkout.razorpay.com` and the bank/UPI pages Razorpay opens. Do not block third-party navigation inside the webview.
- UPI intent: Razorpay may try to open UPI apps (`upi://`, `gpay://`, `phonepe://` and similar). The webview must let the system handle those links. On Android, handle unknown schemes and start an intent. On iOS, allow `LSApplicationQueriesSchemes` for the UPI apps you want to support.
- Allow popups / `window.open`, which some banks use for 3-D Secure.
- Do not add a pull-to-refresh that reloads the page.
- Android: handle the hardware Back button. If the member goes back out of the webview before paying, nothing is charged.

### 5.2 Messages from the page to the app

The page sends one JSON message to the app after each important step, through `window.ReactNativeWebView.postMessage(...)`:

```json
{ "type": "payment", "status": "paid" }
```

| `status` | When it is sent | What the app should do |
|---|---|---|
| `paid` | The payment is confirmed and the member has access | Close the webview, then re-read the member's communities (section 6) |
| `closed` | The member dismissed the Razorpay popup without paying. The page stays open on the Pay button | Usually nothing. Let them pay again or close the webview themselves |
| `error` | The link was invalid or expired, or the page could not confirm the payment | Close the webview and go to section 6 anyway. **Money may have been taken** and access may still arrive |

Notes:

- React Native receives this in the `onMessage` prop of `react-native-webview` as `event.nativeEvent.data` (parse it as JSON).
- Other platforms: the page looks for an object called `ReactNativeWebView` with a `postMessage` function on `window`. If your webview is not React Native, inject a small script before the page loads that defines `window.ReactNativeWebView = { postMessage: msg => <your native bridge>(msg) }`. Without it the page still works, but the app gets no message, so you would have to detect completion yourself (by polling section 6).
- **Treat the message as a hint, never as proof.** Always confirm with the backend (section 6) before telling the member they are subscribed.

## 6. Step 4: confirm the result in the app

After the webview reports `paid` (or `error`, or the member closes it), ask the backend what the member owns.

### `GET /auth/mobile/me`

Mobile only. Returns the profile and **every paid community the member has ever bought**, one row each, with the latest expiry date.

```json
{
  "success": true,
  "data": {
    "user": { "email": "…", "phone": "…", "avatarUrl": null, "postNotificationsEnabled": true, "panSubmitted": false, "dateOfBirth": null },
    "communities": [
      {
        "id": "6f0c…-uuid",
        "name": "Swing Trading Club",
        "slug": "swing-trading-club",
        "description": "…",
        "tags": ["stocks"],
        "coverImageUrl": "https://…",
        "badgeUrl": "https://…",
        "expiresAt": "2027-02-01",
        "invoice": {
          "id": "9b1e…-uuid",
          "number": "FS/2026-27/0184",
          "issuedAt": "2026-11-01T05:12:00.000Z",
          "amount": 1178.82,
          "currency": "INR",
          "downloadUrl": "https://…signed…/FS-2026-27-0184.pdf?X-Amz-…",
          "fileName": "FS-2026-27-0184.pdf"
        }
      }
    ]
  }
}
```

- `expiresAt` is a date (`YYYY-MM-DD`), the **last day** the member has access. They have access today if `expiresAt >= today`. An older date means the plan lapsed (the community stays in the list so you can show **Renew**).
- If the community you just bought has the new `expiresAt`, the purchase is done. Show success.
- `invoice` is the invoice for the member's **latest purchase** of that community, so a **Download invoice** button can sit next to each community. It is `null` when the member never paid for it in the app (an admin added them), so hide the button then. `amount` is the total paid, GST included.
- `downloadUrl` is a signed link straight to the PDF. **It works for about 5 minutes**, so open it when the member taps the button; do not store it. If it has expired, or it is `null` (the file could not be prepared at that moment), call `GET /payments/receipts/{invoice.id}/download` for a fresh one (see `mobile-payment-receipts.md`).

### If it is not there yet

A payment can be confirmed a moment late (the page's confirmation call failed and the Razorpay webhook has to do it). So do not show failure right away:

1. Call `GET /auth/mobile/me`.
2. If the community or the new `expiresAt` is not there, wait 2 seconds and try again. Up to about 5 tries (10 seconds).
3. If it is still not there, show: *"We're confirming your payment. If money was deducted, your access will be added shortly. You do not need to pay again."* Do **not** start a new checkout straight away, because the member may have been charged.
4. Access will arrive on its own, together with the notification in section 8.

### Opening the community

Access to the feed is checked live against the database on every call, so the member can open the community immediately after paying. There is no need to log in again.

`GET /mobile/posts?communityId=<id>` returns `403` with `code: "SUBSCRIPTION_REQUIRED"` when the member has no active, unexpired subscription to that community. You can use this as a gate: on that code, show the plan picker for that community.

## 7. What happens inside the webview (for reference)

You do not call these from the app. The webview page calls them. They are listed so you can understand errors, testing and logs.

| Call | Auth | What it does |
|---|---|---|
| `POST /payments/checkout/exchange` | none; the one-time token is the credential | Burns the token (a second use gets `401`), returns the order and a `sessionToken` valid for 15 minutes by default |
| `POST /payments/checkout/verify` | `Authorization: Bearer <sessionToken>` | Checks Razorpay's signature and gives the member the plan |
| `GET /payments/checkout/status` | `Authorization: Bearer <sessionToken>` | Says whether the order is `created`, `paid` or `failed`. The page uses it after the popup closes, in case the webhook already granted the plan |

`exchange` response:

```json
{
  "sessionToken": "…",
  "status": "created",
  "orderId": "order_ABC123",
  "amount": 117882,
  "baseAmount": 99900,
  "gstAmount": 17982,
  "gstRatePercent": 18,
  "currency": "INR",
  "keyId": "rzp_live_…",
  "planName": "3 Month",
  "durationMonths": 3,
  "communityName": "Swing Trading Club"
}
```

`verify` request: `{ "razorpayPaymentId": "pay_…", "razorpaySignature": "…" }`. Response:

```json
{
  "subscriptionId": "…-uuid",
  "communityId": "…-uuid",
  "planId": "…-uuid",
  "payment": 999,
  "validUntil": "2027-02-01",
  "isActive": true
}
```

A `sessionToken` only reaches the one order it was made for.

Errors the page can hit:

| Call | Status | `code` | Meaning |
|---|---|---|---|
| exchange | 400 | | Token is malformed (too short or too long) |
| exchange | 401 | | Token expired or already used: *"This checkout link has expired — go back to the app and try again"* |
| verify, status | 401 | | Missing or expired session: *"This checkout session has expired"* |
| verify | 400 | `PAYMENT_SIGNATURE_INVALID` | Signature does not match. The order is left untouched and can still be paid |
| verify | 409 | `ORDER_ALREADY_PAID` | The order was already paid by a **different** payment (a double payment, needs a refund) |

If the member opens the checkout for an order that is already paid, the page jumps straight to "Payment successful" and sends `paid`.

## 8. Notifications after a purchase

When the plan is granted, the member also gets:

- An **in-app notification** (in their notification inbox) and a **live event** on the notifications socket.
- A **push notification**.
- An email.

| First purchase of that community | Renewal |
|---|---|
| type `community-added` | type `subscription-extended` |
| title: *You've been added to <community name>* | title: *Access extended* |
| message: *You're active until <date>.* | message: *You're active until <date>.* |

The routing `data` on the notification and the push is:

```json
{ "type": "subscription", "id": "<communityId>", "communityId": "<communityId>", "event": "community-added" }
```

`event` is `community-added` or `extended`. Use it to open that community when the member taps the notification.

If the member is looking at the payment screen when this arrives, do not show a second "success" message on top of your own. Treat the notification as a signal to refresh `GET /auth/mobile/me`.

## 9. Rules the backend applies (so you can word your UI)

- **Buying the same community again renews it.** If the member's plan is still active, the new period is added **after the current end date**, so buying early never loses remaining days. If it already lapsed, the new period starts today.
- **Duration is calendar months.** A 3 Month plan bought on 1 Nov 2026 ends 1 Feb 2027. When the day does not exist in the target month (for example 31 Jan + 1 month), the end date is the last day of that month.
- **The price paid is fixed when the order is made.** If an admin changes the plan price or the GST rate after the member started the checkout, the member is still charged (and recorded as paying) the total they were shown.
- **The same order can only be paid once.** Extra payments for an already paid order are not given a second plan. They are logged for a refund.
- **A failed payment does not close the order.** The member can try again with the same order (it is reused for 15 minutes), and after that a new one is made.
- **A payment for the wrong amount is not given access.** The webhook only grants the plan when the amount paid equals the order's total (GST included).
- **The free community cannot be bought.** Every member is in it already.

## 10. If money is taken but the app never hears back

The member may pay and then lose network, kill the app, or close the webview. This is handled on the server: Razorpay's webhook (`order.paid` / `payment.captured`) grants the plan even when the page never confirmed. The app does not call the webhook.

What the app should do:

- On launch and on coming back to the foreground, call `GET /auth/mobile/me`. A missed purchase appears there.
- Handle the push and the in-app notification from section 8.
- Never tell the member to pay again just because the page showed an error. The page itself says: *"If money was taken, your access will be added shortly — you don't need to pay again."*

## 11. Alternative: pay with the Razorpay native SDK

The backend also has plain endpoints for a native checkout, if you prefer the Razorpay Android/iOS/React Native SDK to the webview. They work with the mobile session cookie too (any logged-in member, web or mobile). The webview flow above is the one built for the mobile app, so use it unless there is a reason not to.

1. `POST /communities/:communityId/plans/:planId/orders` (no body) returns `201`:

   ```json
   { "orderId": "order_ABC123", "amount": 117882, "currency": "INR", "keyId": "rzp_live_…", "planId": "…", "communityId": "…", "baseAmount": 99900, "gstAmount": 17982, "gstRatePercent": 18 }
   ```

   `amount` is the total in paise, GST included; `baseAmount` and `gstAmount` are its parts (`gstAmount` is `0` when no GST is added). Errors: `400` (free community, or total below ₹1), `404` (community or plan not found).
2. Open the Razorpay SDK with `keyId`, `orderId`, `amount` and `currency`.
3. On success, Razorpay returns `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature`. Send them to `POST /payments/verify`:

   ```json
   { "razorpayOrderId": "order_ABC123", "razorpayPaymentId": "pay_…", "razorpaySignature": "…" }
   ```

   Response `200` is the same object as the webview `verify` response (section 7). Errors: `400` `PAYMENT_SIGNATURE_INVALID`, `404` (order is not this member's), `409` `ORDER_ALREADY_PAID`, `400` for a missing field.
4. Even here, the webhook is the safety net, and `GET /auth/mobile/me` is how you confirm.

Calling `verify` twice with the same payment returns the same result (it is safe to retry). A different payment on an already paid order returns `409`.

## 12. Test checklist

- Buy a first plan: the community shows up in `GET /auth/mobile/me` with `expiresAt` equal to today plus the plan months. A `community-added` notification arrives.
- Buy the same community again before it expires: `expiresAt` moves forward from the old end date. A `subscription-extended` notification arrives.
- Tap Buy, close the webview before paying, tap Buy again: it works, and no second Razorpay order is made inside 15 minutes.
- Open the same `checkoutUrl` twice (or reload): the second attempt shows the "link is not valid" page. Starting a fresh checkout fixes it.
- Wait over 2 minutes before opening the URL: the page shows the "link has expired" message.
- Dismiss the Razorpay popup: the app gets `closed`, and the page stays on the Pay button.
- Kill the app right after a successful payment: on next launch `GET /auth/mobile/me` shows the community.
- Start more than 10 checkouts in an hour: the 11th gets `429`.
- Try to buy the free community: `400`.
- Use a web login against `POST /payments/checkout-sessions`: `403` `MOBILE_ONLY`.
- Razorpay test mode: use the test key and Razorpay's test cards and UPI ids. The page gets its `keyId` from the backend, so the app needs no Razorpay key.

## 13. What the backend needs configured (for your information)

| Setting | Purpose | Default |
|---|---|---|
| `PAYMENT_CHECKOUT_URL` | The page the app opens (the base of `checkoutUrl`) | `<FRONTEND_URL>/pay/checkout` |
| `PAYMENT_CHECKOUT_TOKEN_TTL_SECONDS` | How long the one-time token in the URL lasts | `120` |
| `PAYMENT_SESSION_TTL_SECONDS` | How long the page's session lasts after it opens | `900` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys | none |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay's webhook calls | none |

The Razorpay dashboard must have the webhook `POST /api/v1/payments/webhooks/razorpay` enabled with the events `order.paid`, `payment.captured` and `payment.failed`.
