# Payment receipts for plan purchases (mobile)

When a member pays for a community plan, the server issues a **payment receipt** (PDF), stores it, and attaches it to the "You're active" email. The app can list the receipts and open the PDF at any time.

It is a payment receipt, not a GST tax invoice: plan prices have no tax split. Service quotes still get a full GST invoice (see `mobile-quote-payment.md`).

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

## 3. Email

The member also gets the PDF as an attachment on the "added to community" or "access extended" email. Members without an email on file just get the in-app receipt.

## 4. Service invoices (GST) for the app

Paid service requests keep their GST invoice as before: the request detail has `invoice` and the download call is in `mobile-quote-payment.md`. Both kinds are stored as PDFs in the invoices bucket and attached to the payment email.

## 5. Admin side

- Web: the member's page (`/admin/members/<id>`) shows a "Payment receipts" list with a download button for each.
- API: `GET /api/v1/admin/receipts?userId=<id>` and `GET /api/v1/admin/receipts/<receiptId>/download`. An admin can use them only for members they may open (a subscription in a community they manage); super admins see everyone. Service invoices: `GET /api/v1/admin/services/<requestId>/invoice`.
