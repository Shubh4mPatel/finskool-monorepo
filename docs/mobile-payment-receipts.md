# Payment receipts for plan purchases (mobile)

When a member pays for a community plan, the server issues a **payment receipt** (PDF), stores it, and attaches it to the "You're active" email. The app can list the receipts and open the PDF at any time.

The PDF is laid out as an invoice (see "What the PDF shows" below), but plan prices carry no GST, so there is no tax split on it: the total is the amount paid. Service quotes still get a full GST invoice (see `mobile-quote-payment.md`).

## 1. List receipts

`GET /api/v1/payments/receipts` (logged-in member, newest first, up to 100)

```json
{ "success": true, "data": [
  { "id": "a127362a-…", "number": "RCPT/2026-27/0001", "issuedAt": "2026-11-02T12:59:41.567Z",
    "description": "Community One - Annual (12 months)", "amount": 999, "currency": "INR" }
] }
```

A receipt appears right after a successful payment (the same moment the subscription starts). If the list is empty straight after paying, retry once after a second.

## 2. Download one

`GET /api/v1/payments/receipts/{id}/download`

```json
{ "success": true, "data": { "url": "https://…", "fileName": "RCPT-2026-27-0001.pdf" } }
```

Open `url` straight away (in the system viewer or a share sheet); it expires after a few minutes, so do not store it. Call this endpoint again whenever the member taps "Download".

Errors: `404` the receipt does not exist or belongs to someone else; `400` the id is not a UUID.

## What the PDF shows

One A4 page, in the brand's colours and the Inter font (so the rupee sign prints properly):

| Section | Content |
|---|---|
| Header | The logo and seller name, with "SEBI Registered Research Analyst · <registration no.>" when that number is set. On the right, **Amount paid** and "Paid on <date>" |
| Billed to | The member's name, email and phone |
| Invoice details | The receipt number (`RCPT/2026-27/0184`) and date |
| Item | The community and plan, what the plan is, the SAC code (when set), the **days of access** it bought (first and last day), and the amount |
| Total | The amount paid, and in words |
| Payment | How it was paid (UPI / card / netbanking, with the id masked: `aman.v•••@okhdfcbank`, `Visa ••••4242`), paid through Razorpay, the time paid, the payment and order ids, and the status |
| Note | "Access is active from <date> to <date> and does not renew automatically", and who to write to about billing |
| Footer | Seller name and proprietor, address, GSTIN and PAN, contact email, phone and website, and the SEBI disclaimer |

Anything that is not known is left out rather than printed blank. In particular:

- A receipt issued before this layout has no access dates or payment details, so those parts are missing from it. PDFs that were already stored are not redrawn.
- If Razorpay cannot be asked how a payment was made when the receipt is issued (it is down, slow or not configured), the receipt is still issued, without the payment method.
- The SEBI line and disclaimer appear only when a SEBI registration number is set in **Settings > Billing**.

Who sold it comes from **Settings > Billing** (super admin): legal name, address, GSTIN, SAC code, contact details, and the optional **Proprietor**, **PAN**, **SEBI registration no.** and **Website**. It is copied onto each receipt when it is issued, so changing the settings later does not alter receipts already issued.

The JSON in sections 1 and 2 is unchanged: the app needs no update for the new look.

## 3. Email

The member also gets the PDF as an attachment on the "added to community" or "access extended" email. Members without an email on file just get the in-app receipt.

## 4. Service invoices (GST) for the app

Paid service requests keep their GST invoice as before: the request detail has `invoice` and the download call is in `mobile-quote-payment.md`. Both kinds are stored as PDFs in the invoices bucket and attached to the payment email.

## 5. Admin side

- Web: the member's page (`/admin/members/<id>`) shows a "Payment receipts" list with a download button for each.
- API: `GET /api/v1/admin/receipts?userId=<id>` and `GET /api/v1/admin/receipts/<receiptId>/download`. An admin can use them only for members they may open (a subscription in a community they manage); super admins see everyone. Service invoices: `GET /api/v1/admin/services/<requestId>/invoice`.
