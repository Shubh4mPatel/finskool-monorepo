# Collecting a quote payment in the mobile app

How the app takes payment for a service quote with Razorpay. This is the focused guide for the **payment part** of the Services module. For the rest (catalog, chat, requests) see `mobile-services-integration.md`.

**The idea in one paragraph.** An admin sends the member a quote in the request chat. The member taps **Pay** on the quote card, confirms the billing details that go on their GST invoice, and the app asks our server to create a Razorpay **order** for that quote. The app opens **Razorpay Checkout** with that order, the member pays, and the app sends the result back to our server to **verify**. The server then marks the request paid and issues a GST invoice automatically. If the app is closed before it can verify, Razorpay tells our server directly, so the payment is never lost.

All endpoints below are under `/api/v1/mobile/services` and need the `mobile_session_id` cookie, like every other mobile call.

## 1. The calls at a glance

```
(quote card says "Pay")
   1. GET  /gst-states                       the state list for the billing sheet
   2. POST /:requestId/quotes/:quoteId/pay   -> { orderId, amount, keyId, ... }
   3. Razorpay Checkout (SDK, on the phone)  -> { paymentId, orderId, signature }
   4. POST /:requestId/payments/verify       -> the request, now "paid", with its invoice
   5. GET  /:requestId/invoice               -> a link to the GST invoice PDF
```

Four of these are our API; step 3 is the Razorpay SDK. You never call Razorpay's own web API from the app.

## 2. Money rules the app must respect

- **The total is what the member pays.** `totalAmount = baseAmount + gstAmount`. GST is added **on top** of the admin's price, at the rate shown on the quote (18% by default).
- **Rupees in the quote, paise in the order.** Quote fields (`baseAmount`, `gstAmount`, `totalAmount`) are in **rupees**. The `amount` returned by `/pay` is in **paise** (rupees x 100) because that is what Razorpay uses. Do not mix them.
- **The server decides the amount.** Always open Checkout with the `orderId` and `amount` returned by `/pay`. Never calculate the amount in the app.
- **One order per quote.** Calling `/pay` again for the same quote returns the same order, so double taps are harmless.
- **Currency is always INR.**

Example. The admin quotes Rs 10,000. At 18% GST the quote shows:

| | Rupees | Paise sent to Checkout |
|---|---|---|
| Service fee (`baseAmount`) | 10,000.00 | |
| GST 18% (`gstAmount`) | 1,800.00 | |
| **Total (`totalAmount`)** | **11,800.00** | **1180000** (`amount`) |

## 3. Step 1: show a quote the member can pay

A quote arrives in the chat as a **quote card** (a message with `kind: "quote"`), and the request carries the current payable quote in `request.quote`.

```json
{
  "id": "6cfc…", "requestId": "47d4…", "version": 2,
  "baseAmount": 12000, "gstRatePercent": 18, "gstAmount": 2160, "totalAmount": 14160,
  "currency": "INR",
  "note": "Monthly management fee, billed upfront.",
  "expiresAt": "2026-11-07T07:04:11.000Z",
  "status": "active",
  "createdAt": "2026-11-02T07:04:11.000Z"
}
```

Show the **Pay** button only when `quote.status == "active"` **and** `request.status == "quote_sent"`.

| `quote.status` | What the card shows |
|---|---|
| `active` | Breakdown (fee, GST, total), a countdown to `expiresAt`, and **Pay** |
| `paid` | "Paid" |
| `superseded` | Greyed out: "Replaced by a newer quote". The admin sent a revised quote; only the new one can be paid |
| `expired` | Greyed out: "Expired". The member asks the admin for a new quote in the chat |
| `cancelled` | Greyed out: "Withdrawn" |

The status is always current (a quote past its expiry already reads `expired`). Quotes change live: you get `service.message` (a new quote card) and `service.updated` over the socket, so keep the card in sync with those events.

## 4. Step 2: the billing sheet

Before paying, the member confirms the details printed on the GST invoice. Show a sheet with:

| Field | Rules |
|---|---|
| Name | Required, up to 150 characters. Pre-fill from the profile |
| State | Required. A picker fed by `GET /gst-states` |
| GSTIN | Optional. Only for an invoice in a business name. 15 characters, must be a valid GSTIN, and its first two digits must match the state's code |
| Address | Optional, up to 300 characters |

```
GET /api/v1/mobile/services/gst-states
```
`data`: `[ { "code": "27", "name": "Maharashtra" }, { "code": "29", "name": "Karnataka" }, … ]`. Cache this list; it rarely changes.

**Why the state matters:** it decides how the invoice shows the tax (CGST + SGST for the same state as the business, IGST for another state). **The total never changes** with the state.

Remember the last billing details locally and pre-fill them next time.

## 5. Step 3: create the order

When the member confirms the sheet:

```
POST /api/v1/mobile/services/{requestId}/quotes/{quoteId}/pay
Content-Type: application/json

{
  "billing": {
    "name": "Priya Sharma",
    "stateCode": "27",
    "gstin": "29AABCT1332L1ZA",
    "address": "12 MG Road, Bengaluru"
  }
}
```

`gstin` and `address` are optional (leave them out when empty). Response `200`:

```json
{
  "success": true,
  "data": {
    "orderId": "order_Q3xAbC123",
    "amount": 1416000,
    "currency": "INR",
    "keyId": "rzp_live_xxxxxxxx",
    "quoteId": "6cfc…",
    "requestId": "47d4…"
  }
}
```

Use `orderId`, `amount` and `keyId` for Checkout (next step). `keyId` is the public Razorpay key (a `rzp_test_` key on a test server, `rzp_live_` on production), so the app needs no Razorpay key of its own.

**Errors**

| Status / `code` | Meaning | What the app does |
|---|---|---|
| 422 (`errors.billing...`) | A billing field is invalid | Show the message beside the field |
| 409 `QUOTE_EXPIRED` | The quote just expired | "This quote has expired. Ask for a new one." Refresh the request |
| 409 `QUOTE_NOT_PAYABLE` | Replaced, withdrawn, or nothing to pay | Refresh the request; the card shows why |
| 409 `SERVICE_ALREADY_PAID` | Already paid | Refresh the request |
| 409 `SERVICE_CLOSED` | The request is closed | Refresh the request |
| 409 `BILLING_NOT_CONFIGURED` | The business has not finished billing set-up | "Payments aren't available yet." (contact support) |
| 404 | Not found, or not this member's | Close the sheet, refresh |
| 502 `PAYMENT_GATEWAY_ERROR` | Razorpay could not create the order | "Couldn't start the payment. Please try again." |
| 503 `PAYMENTS_NOT_CONFIGURED` | Payments are off on the server | "Payments aren't available right now." |
| 401 `SESSION_INVALIDATED` | Logged out | Go to login |

Disable the Pay button while this call is in flight.

## 6. Step 4: open Razorpay Checkout

Use Razorpay's official SDK for your platform (Flutter: `razorpay_flutter`; Android, iOS and React Native SDKs exist too). Follow the SDK's own setup notes for each platform. Open it with the values from step 3.

```dart
final razorpay = Razorpay();
razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, onSuccess);
razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, onFailure);
razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, onExternalWallet);

razorpay.open({
  'key': order.keyId,            // from /pay
  'order_id': order.orderId,     // from /pay: this ties the payment to our quote
  'amount': order.amount,        // paise, from /pay
  'currency': order.currency,    // "INR"
  'name': 'Finskool',
  'description': 'Service request ${request.label}',   // e.g. "SR-12"
  'prefill': {'contact': user.phone, 'email': user.email ?? ''},
  'theme': {'color': '#108B8B'},
  'retry': {'enabled': true, 'max_count': 3},
});
```

Rules:

- **Always pass `order_id`.** Without our order the payment cannot be matched to the quote.
- Do not change `amount`, and do not let the member edit it.
- Dispose the Razorpay instance (`razorpay.clear()`) when the screen closes.
- While Checkout is open the **server holds the quote for 15 minutes**: it will not expire it or let an admin replace it silently during that time.

### What Checkout gives you

| Event | Meaning | Data |
|---|---|---|
| Success | The member paid | `paymentId`, `orderId`, `signature` |
| Error | The payment failed or the member closed the sheet | `code`, `message`. Code 2 means the member cancelled |
| External wallet | The member chose a wallet app | Nothing to do; wait for success or error |

On **error or cancel**: nothing was charged (or the bank reverses it by itself). Do **not** call `/verify`. Show a short message ("Payment cancelled" or the failure reason) and leave the quote card payable. The member can tap Pay again.

## 7. Step 5: verify the payment

A "success" from Checkout is not enough. The request becomes paid only when our server verifies it. Immediately after success, show a **"Confirming your payment…"** screen and call:

```
POST /api/v1/mobile/services/{requestId}/payments/verify
Content-Type: application/json

{
  "razorpayOrderId":   "<orderId from Checkout>",
  "razorpayPaymentId": "<paymentId from Checkout>",
  "razorpaySignature": "<signature from Checkout>"
}
```

Response `200`: **the request**, now with the payment applied:

```json
{
  "success": true,
  "data": {
    "id": "47d4…", "label": "SR-12", "status": "paid", "paidAt": "2026-11-02T08:02:11.000Z",
    "quote": { "status": "paid", "totalAmount": 14160, "…": "…" },
    "invoice": { "id": "…", "number": "FS/2026-27/0001", "issuedAt": "2026-11-02T08:02:11.000Z", "total": 14160 }
  }
}
```

**Decide what to show from the response, not from Checkout:**

| What you get back | What it means | Show |
|---|---|---|
| `status: "paid"` and `invoice` is set | Paid and invoiced | The success screen (section 8) |
| `status` is not `paid` (still `quote_sent`) | The money arrived but could not be applied, because the quote was replaced or expired while the member was paying | "We received your payment and our team will review it. You do not need to pay again." A system message is also posted in the chat. **Never** offer to pay again for this |
| `400 PAYMENT_SIGNATURE_INVALID` | The signature did not match | "We couldn't confirm this payment." Do not mark it paid. Ask them to contact support if they were charged |
| Network error or timeout | You do not know yet | **Retry** `/verify` (it is safe to repeat). If it still fails, refetch `GET /:requestId`, or wait for the `service.updated` socket event: the server is also told by Razorpay and has usually confirmed it already |
| `404` | The order is not found or not this member's | Refresh the request |

`/verify` is **idempotent**: calling it again, or after Razorpay's own notification already confirmed the payment, returns the same paid request. You never risk paying or invoicing twice.

## 8. After payment

- Show a success screen: "Payment received", the amount, the invoice number and a **Download invoice** button.
- Update the request card in the list and the chat: status becomes `paid` (the work is being delivered). The quote card shows "Paid".
- A system message "Payment received" is added to the chat. It arrives over the socket (`service.message`), and the request changes through `service.updated`. Merge them, do not add a second copy yourself.
- The invoice is **also emailed** to the member if they have an email on their account.

### The invoice

```
GET /api/v1/mobile/services/{requestId}/invoice
```
`data`: `{ "url": "https://…", "fileName": "FS-2026-27-0001.pdf" }`. The link is short-lived (minutes), so request it when the member taps Download and open it right away in the system PDF viewer or share sheet. `404` means the request is not paid yet. The very first call right after payment can take a moment because the PDF is created on demand.

The invoice shows the business and the member's billing details, the fee, the GST split (CGST + SGST or IGST) and the total. The number is sequential, for example `FS/2026-27/0001`.

## 9. If something goes wrong mid-payment

| Situation | What happens | What the app does |
|---|---|---|
| The member closes Checkout | Nothing is charged | Leave the card payable |
| The payment fails | Nothing is charged | Show the reason, allow retry |
| The app is killed or loses network **after paying** | The money was taken. Razorpay notifies our server directly, which marks the request paid and issues the invoice | On the next launch (and when the app returns to the foreground) **refetch the request**. It will already be `paid`. Do not make the member pay again |
| `/verify` cannot be reached | Same as above | Retry, then refetch |
| The member pays a quote that was replaced or expired in the meantime | The payment is recorded, **no invoice is issued**, and the support team is alerted to pay it back | See section 7, second row. Show the "under review" message |
| The member taps Pay on two devices | Both get the same order; only one payment can settle it | The other device sees the request become `paid` through the socket and refreshes |
| Pay is tapped after the request was cancelled or closed | `409 SERVICE_CLOSED` | Refresh |

**Refunds are not done in the app.** The support team pays money back manually from the Razorpay dashboard. The app has no refund screen.

## 10. A small payment service (Dart)

```dart
class QuotePaymentService {
  QuotePaymentService(this.api); // a Dio with the session cookie
  final Dio api;
  static const base = '/api/v1/mobile/services';

  Future<List<GstState>> gstStates() async {
    final r = await api.get('$base/gst-states');
    return (r.data['data'] as List).map((e) => GstState.fromJson(e)).toList();
  }

  /// Creates (or re-fetches) the Razorpay order for this quote.
  Future<PayOrder> createOrder(String requestId, String quoteId, Billing billing) async {
    final r = await api.post('$base/$requestId/quotes/$quoteId/pay', data: {'billing': billing.toJson()});
    return PayOrder.fromJson(r.data['data']);
  }

  /// Confirms the payment. Safe to call again, so it retries on network errors.
  Future<ServiceRequest> verify(String requestId, PaymentSuccessResponse p) async {
    for (var attempt = 0; ; attempt++) {
      try {
        final r = await api.post('$base/$requestId/payments/verify', data: {
          'razorpayOrderId': p.orderId,
          'razorpayPaymentId': p.paymentId,
          'razorpaySignature': p.signature,
        });
        return ServiceRequest.fromJson(r.data['data']);
      } on DioException catch (e) {
        final network = e.response == null;
        if (!network || attempt >= 4) rethrow;          // real answers are final
        await Future.delayed(Duration(seconds: 1 << attempt)); // 1s, 2s, 4s, 8s
      }
    }
  }

  Future<String> invoiceUrl(String requestId) async {
    final r = await api.get('$base/$requestId/invoice');
    return r.data['data']['url'] as String;
  }
}
```

And the screen logic:

```dart
Future<void> pay(ServiceRequest req, Quote quote, Billing billing) async {
  setState(PayState.starting);
  final order = await service.createOrder(req.id, quote.id, billing);   // errors -> section 5
  razorpay.open(checkoutOptions(order, req));                           // section 6
  setState(PayState.inCheckout);
}

void onSuccess(PaymentSuccessResponse p) async {
  setState(PayState.confirming);                                        // "Confirming your payment…"
  try {
    final updated = await service.verify(req.id, p);
    if (updated.status == 'paid' && updated.invoice != null) {
      showSuccess(updated.invoice!);
    } else {
      showUnderReview();                                                // money received, not applied
    }
  } on DioException catch (e) {
    if (e.response?.data['code'] == 'PAYMENT_SIGNATURE_INVALID') showCouldNotConfirm();
    else showPendingAndRefetch();                                       // unknown: refetch the request
  }
}

void onFailure(PaymentFailureResponse f) {
  setState(PayState.idle);                                              // quote stays payable
  showToast(f.code == Razorpay.PAYMENT_CANCELLED ? 'Payment cancelled' : (f.message ?? 'Payment failed'));
}
```

## 11. Do and do not

**Do**
- Open Checkout only with an order from `/pay`.
- Decide success from the `/verify` response, not from Checkout's callback.
- Retry `/verify` on network errors; refetch the request when unsure.
- Refetch the request on app start and when returning to the foreground.
- Disable buttons while a call is running.
- Show GST clearly on the quote card (fee, GST, total).

**Do not**
- Do not compute or edit the amount in the app.
- Do not mark a request paid from the client's own state.
- Do not offer a second payment when `/verify` says the first one is under review.
- Do not store or log the Razorpay signature or payment ids beyond what you need for the call.
- Do not call Razorpay's web API from the app.

## 12. Testing

Ask for a server pointed at Razorpay **test mode** (its `keyId` starts with `rzp_test_`). Nothing real is charged there. Use Razorpay's test payment details from their documentation, for example a test card `4111 1111 1111 1111` with any future expiry and any CVV, or the test UPI id `success@razorpay` (and `failure@razorpay` to see a failure).

Checklist:

1. A quote card shows the fee, GST, total and a countdown, with a working Pay button.
2. Tap Pay and fill the billing sheet: invalid GSTIN, a GSTIN that does not match the state, and an empty name each show an error under the field.
3. A valid payment ends on the success screen with an invoice number, and the invoice PDF downloads.
4. Cancel inside Checkout: back on the chat, the quote is still payable.
5. Pay with the failure UPI id: a failure message, the quote is still payable.
6. Tap Pay twice quickly: one order, one payment sheet.
7. Pay, then kill the app before it confirms. Reopen it: the request is already `paid`.
8. In airplane mode right after paying: the confirming screen retries, and the request shows `paid` when the network returns.
9. Ask the admin to send a **revised** quote while the member has the old one open: the old card greys out with "Replaced by a newer quote", and Pay on it is refused with `QUOTE_NOT_PAYABLE`.
10. Let a quote expire: the card shows "Expired", and Pay is refused with `QUOTE_EXPIRED`.
11. Pay a quote that the admin replaced mid-payment: the app shows "under review" and does not ask to pay again.
12. Log in on a second phone, pay on one: the other updates to `paid` within a few seconds.
13. A request that was already paid cannot be paid again (`SERVICE_ALREADY_PAID`).
14. The invoice email arrives for a member with an email address.

## 13. Quick reference

| Need | Call |
|---|---|
| State list for the sheet | `GET /api/v1/mobile/services/gst-states` |
| Create the order | `POST /api/v1/mobile/services/:requestId/quotes/:quoteId/pay` |
| Confirm the payment | `POST /api/v1/mobile/services/:requestId/payments/verify` |
| Current state of the request | `GET /api/v1/mobile/services/:requestId` |
| Invoice PDF link | `GET /api/v1/mobile/services/:requestId/invoice` |
| Live changes | `service.message`, `service.updated` on `wss://<host>/ws/tickets` |
