# Transaction history API (mobile)

The logged-in member's own payments, newest first: community plans and service quotes, including attempts that failed.

## Request

```
GET /api/v1/mobile/transactions?from=2026-11-01&to=2026-11-30&page=1&pageSize=20
```

Auth: the normal mobile session (the same as the other `/mobile/*` calls).

| Query | Notes |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, IST days, both included. Optional. `from` after `to` gives `400`. |
| `page` | 1-based. Default `1`. |
| `pageSize` | Default `20`, max `50`. |

No search, status filter or totals.

## Response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "plan:7c1e…",
        "kind": "community",
        "status": "paid",
        "occurredAt": "2026-11-13T04:54:00.000Z",
        "amount": 11999,
        "currency": "INR",
        "title": "Intraday Community",
        "planMonths": 12,
        "planName": "Yearly",
        "reference": null,
        "paymentId": "pay_Qx…",
        "method": null,
        "failureReason": null,
        "invoice": { "number": "FS/2026-27/0184", "downloadPath": "/api/v1/payments/receipts/a127…/download" }
      },
      {
        "id": "svc:55d2…",
        "kind": "service",
        "status": "failed",
        "occurredAt": "2026-11-12T09:12:00.000Z",
        "amount": 25000,
        "currency": "INR",
        "title": "Intelligent Model Portfolio",
        "planMonths": null,
        "planName": null,
        "reference": "SR-12 · Quote 1",
        "paymentId": "pay_Rt…",
        "method": "card",
        "failureReason": "Card expired",
        "invoice": null
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

## Fields

- `kind`: `community` (has `planMonths`, `planName`) or `service` (has `reference`, the request and quote).
- `status`:
  - `paid`: done.
  - `failed`: the attempt failed and nothing was deducted. `failureReason` says why.
  - `flagged`: the money was received but could not be applied and the team is looking into it. Show "Under review".
- `occurredAt` is UTC; display it in IST.
- `amount` is in rupees (not paise) and includes GST.
- `invoice` is `null` for failed and flagged payments.

## Opening an invoice

Call `GET {invoice.downloadPath}`. It returns:

```json
{ "success": true, "data": { "url": "https://…", "fileName": "FS-2026-27-0184.pdf" } }
```

Open `url` straight away. It expires after a few minutes, so don't store it; call the endpoint again each time.

## Errors

`400` bad date or paging values · `401` not signed in.

## Notes

- A new payment goes to the top, so a member paging through the list may see one row repeat on the next page.
- `id` is stable and unique; use it as the list key.
