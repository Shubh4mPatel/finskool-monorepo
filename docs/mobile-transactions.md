# Transaction history (mobile)

The member's own payments, newest first: community plans and service quotes, including attempts that failed.

## List

`GET /api/v1/mobile/transactions` (logged-in mobile member)

| Query | Meaning |
|---|---|
| `from`, `to` | First and last day, `YYYY-MM-DD`, IST, both included. Either can be left out. `from` after `to` is a `400`. |
| `page` | 1-based, default `1`. |
| `pageSize` | Default `20`, at most `50`. |

That is all: no search, status filter or totals.

```json
{ "success": true, "data": {
  "items": [
    { "id": "plan:7c1e…", "kind": "community", "status": "paid", "occurredAt": "2026-11-13T04:54:00.000Z",
      "amount": 11999, "currency": "INR", "title": "Intraday Community", "planMonths": 12, "planName": "Yearly",
      "reference": null, "paymentId": "pay_Qx…", "method": null, "failureReason": null,
      "invoice": { "number": "FS/2026-27/0184", "downloadPath": "/api/v1/payments/receipts/a127…/download" } },
    { "id": "svc:55d2…", "kind": "service", "status": "failed", "occurredAt": "2026-11-12T09:12:00.000Z",
      "amount": 25000, "currency": "INR", "title": "Intelligent Model Portfolio", "planMonths": null, "planName": null,
      "reference": "SR-12 · Quote 1", "paymentId": "pay_Rt…", "method": "card", "failureReason": "Card expired", "invoice": null }
  ],
  "page": 1, "pageSize": 20, "total": 42, "totalPages": 3
} }
```

- `status`: `paid`; `failed` (nothing was deducted); `flagged` (the money was received but could not be applied, and the team is looking into it: show "Under review"). `failureReason` is only set for `failed`.
- `occurredAt` is UTC; show it in IST.
- `kind: community` has `planMonths` / `planName`; `kind: service` has `reference` (the request and quote).
- `invoice` is null for failed and flagged payments, and for a payment whose invoice could not be issued.
- To open the invoice, call `GET {invoice.downloadPath}`; it returns `{ "url", "fileName" }`, a short-lived link (see `mobile-payment-receipts.md` and `mobile-quote-payment.md`). Do not store the link.
- Pages are by number over a list that only grows at the top: a payment made while the member is paging shifts rows down by one.

Errors: `400` bad date or paging, `401` not signed in.
