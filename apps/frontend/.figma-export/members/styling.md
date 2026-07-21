# Members (Member Management)

Admin's member management table: search/filter, paginated member list with status/community tags,
row actions (extend, suspend/revoke, delete), plus 7 modal states used across member actions.
**Desktop-only** — no mobile frame exists for this screen.

## Screenshots in this folder

| File | Source node (whole frame) | Modal shown |
|---|---|---|
| `desktop.png` | `2553:85074` ("-93") | none — base table |
| `modal-add-member.png` | `2553:85861` ("-94") | "Add Member" form |
| `modal-extend-subscription.png` | `2553:87882` ("-97") | "Extend Subscription" (identical spec to the one in `admin-dashboard/`) |
| `modal-delete-user.png` | `2553:88386` ("-98") | "Delete User?" confirm |
| `modal-revoke-suspension.png` | `2553:88872` ("-99") | "Revoke Suspension?" confirm |
| `modal-delete-thread.png` | `2553:94730` ("-115") | "Delete Thread?" confirm — **contextually mismatched**, see Annotations |
| `modal-confirm-mark-all-read.png` | `2553:95231` ("-116") | generic "Confirm Action" (mark-all-read copy) — **contextually mismatched**, see Annotations |
| `modal-suspend-reason.png` | `2553:89372` ("-100" — see Annotations for a node-numbering correction) | "Add Reason for Suspension" |

All modal screenshots are full-frame captures (Members table blurred behind the modal), matching how
each state is actually composited in the Figma file.

## Frame dimensions

- Main table frame (`2553:85074`, "-93"): **2119 × 982** (wider than the standard 1512 admin canvas —
  this table overflows its frame horizontally).
- Modal frames (`-94`, `-97`, `-98`, `-99`, `-115`, `-116`, "-100"): **1490 × 982** each.
- Add Member modal card: 499×678 @ (496,152)
- Extend Subscription modal card: 499×352 @ (514,318) — identical to `admin-dashboard`'s
- Confirm-style dialogs (Delete User / Revoke Suspension / Confirm Action / Delete Thread): 400×275
  (400×267 for the shorter-body "Confirm Action" variant) @ ~(545,353)
- Add Reason for Suspension modal: 457×265 @ (517,359)

## Layout structure

**Main table (`-93`)**:
- Sidebar: identical spec to `admin-dashboard` (269×940, r16, avatar/profile/nav/logout) — "Members" nav
  item active this time.
- Header: "Member Management" (Poppins Bold 22px `#153d3a`) + "View and manage all whitelisted members"
  subtitle, "Add Member" pill button (gradient? — actually plain teal-dark outline pill here, see below)
  and "Bulk Delete" outline button top-right.
- **Stat tile row** (4 cards, 272×118.25 each, r**10** — narrower/shorter than the dashboard's stat
  tiles which use r14/269×164.66): Total Whitelisted 560, Registered 498, Pending Registration 62,
  Expiring This Week 14 (red icon). Icon circle 32×32. Number **Poppins Medium 26px** (not Nunito Bold
  32px like the dashboard — a different type style for the same "stat number" role between screens).
- **Search/filter bar**: card 1141×69, r12, padding 14/18. Search input (fill `#fafaf8`, r10, stroke
  `#d6d2c8`, 283×41), "All Communities" dropdown (170×41), "Paid On" / "Valid Till" date filters
  (150×41 each), "All Status" dropdown (150×41) — all white bg / r10 / stroke `#d6d2c8`. "Export CSV"
  pill button (white bg, r999, stroke `#108b8b` teal) at far right.
- **Table** card: 1764×547 (of the 1803-wide inner `Table` frame), r16. Header row fill `#f5f3ed`.
  Body rows alternate `#ffffff` / `#fafaf8`, each with a bottom border stroke `#f0ede8`, row height
  ~65–66px. Columns: `#`, NAME, Phone number, Payment, valid, paid on, Registered (date), COMMUNITY,
  STATUS, ACTIONS. Pagination footer: "Showing 7 of 560 members" + Previous/1/2/3/…/28/Next page
  buttons (30×29 each, r6, white bg stroke `#d6d2c8`; active page fill `#153d3a`).
- Row action icons (circular, 33×23 pill-ish "Link" buttons, r50, padding 5/10): view (teal stroke
  `#153d3a`), extend "+ Extend" (text pill, fill `#153d3a1a`, teal text), suspend/revoke (green stroke
  `#4caf50` seen on one row — user-tick "revoke suspension" affordance), delete (red stroke `#dc2626`
  or fill `#dc26261a`).

## Colors used on this screen (raw hex)

Baseline palette from `design-tokens.md`: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`,
`#d6d2c8`, `#b0aba1`, `#a0a89e`, `#ede9e2`.

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#dc2626` | Destructive/error accent — delete row icon stroke, "Delete User?"/"Delete Thread?" heading + confirm button, Expiring/urgent stat icon |
| `#dc26261a` | 20%-alpha tint of `#dc2626` — delete-action icon backgrounds, destructive-modal icon-circle background |
| `#4caf50` | Green — "Revoke"/positive confirm actions (Revoke Suspension button, user-tick icon), row revoke-action stroke |
| `#4caf501a` | 20%-alpha tint of `#4caf50` — Revoke Suspension modal icon-circle background |
| `#edfad4` | Light green pill background — "Registered" status badge and "Swing Alpha" community tag |
| `#e0f4f4` | Light teal pill background — "Investor" community tag |
| `#fff3e0` | Light amber pill background — "Expiring Soon" status badge (text `#d97706`, consistent with admin-dashboard) |
| `#fdecea` | Light red pill background — "Expired" status badge |
| `#f0f0ee` | Light gray pill background — "Pending" status badge (text `#888888`) |
| `#f0ede8` | Table row divider stroke (distinct from `#ede9e2`) |
| `#fafaf8` / `#fafafa` | Alternating table row background / input background |
| `#153d3a1a` | 20%-alpha tint of `#153d3a` — "+ Extend" text-pill background |
| `#e5e0d8` | Secondary/Cancel button border stroke (matches admin-dashboard modal) |
| `#292d32` | Near-black icon fill (icon-library default, same flag as admin-dashboard) |
| `#000000` | Raw black on modal headings ("Add Member") — same Inter-heading inconsistency flag as admin-dashboard |
| `#ff383c` | **New, one-off**: "Suspend" button fill on the Add-Reason-for-Suspension modal — a brighter/different red than the `#dc2626` used everywhere else for destructive actions. Flagged as an inconsistent one-off. |
| `#c0c8c0` | Minor icon/border color, negligible |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading ("Member Management") | Poppins | Bold | 22px |
| Stat tile number | **Poppins** | **Medium** | **26px** (differs from admin-dashboard's Nunito Bold 32px for the same role) |
| Stat tile label | Nunito | Regular | 11px |
| Table header cells | Poppins | Bold | 11px |
| Table cell text | Nunito | Regular/Bold | 13px |
| Community/status pill text | Nunito | Bold | 9–11px |
| Sidebar nav (Poppins variant) | Poppins | Regular | 13px |
| Sidebar nav (Nunito variant) | Nunito | SemiBold | 13px |
| Modal field label | Nunito | SemiBold | 13px |
| Modal input value/placeholder | Nunito | Regular | 13px |
| Modal primary/secondary button | Poppins | Medium | 14px |
| Confirm-dialog heading (Delete/Revoke/Confirm) | Poppins | Bold | 16px |
| Confirm-dialog body text | Nunito (mixed run) | ~Regular | 13px, line-height 22.75px |
| **Modal heading "Add Member"/"Extend Subscription" (flagged)** | **Inter** | **Semi Bold** | **22px**, color `#000000` |
| **"Add Reason for Suspension" heading (flagged)** | **Inter** | **Medium** | **22px**, color `#000000` |
| Suspend-reason body/placeholder text | Nunito | Light | 13px |

## Component measurements

- **Stat tile** (Members variant): 272×118.25, corner radius **10**, padding 16/18/16/18, icon circle 32×32.
- **Search/filter bar card**: 1141×69, r12, padding 14/18/14/18. Input/dropdown fields: 41px tall, r10,
  stroke `#d6d2c8`.
- **Table card**: r16, row height 65–66px, header row fill `#f5f3ed`.
- **Status/community pill**: height ~18–21px, corner radius 999, padding 3/10.
- **Row action icon button**: ~23–25px tall × 33–65px wide, corner radius 50 (pill), padding 5/10, 1px stroke.
- **Pagination button**: 29–30×29px, corner radius 6, stroke `#d6d2c8` (active page: fill `#153d3a`, white text).
- **Add Member modal**: 499×678, r20; input fields 452×43, r10, stroke `#d6d2c8`, padding 11/14; buttons
  222×43, pill (r50).
- **Extend Subscription modal**: 499×352, r20 — identical spec to `admin-dashboard/styling.md`.
- **Confirm-style dialog** (Delete User / Revoke Suspension / Confirm Action / Delete Thread): 400×275
  (or 400×267), corner radius 16, padding 32/28/28/32; icon circle 52×52 (r999) with a 20%-alpha tint of
  the action's accent color; Cancel button 86.53×41 pill, white bg, stroke `#153d3a`; confirm button
  ~88–115×41 pill, solid accent fill (`#dc2626` red for destructive, `#4caf50` green for revoke), white text.
- **Add Reason for Suspension modal**: 457×265, r20; icon circle 34×34 (ellipse) with `#dc26261a` tint;
  textarea 408×129, r10, white bg; Cancel 168.46×32 pill (white, stroke `#e5e0d8`); "Suspend" button
  168×32 pill, fill `#ff383c` (flagged one-off red), white text.

## Figma node IDs used

- Main table: `2553:85074`
- Add Member modal frame: `2553:85861` (modal card group `2553:86330`)
- Extend Subscription modal frame: `2553:87882` (modal card group `2553:88351`)
- Delete User modal frame: `2553:88386` (dialog group `2553:88855`)
- Revoke Suspension modal frame: `2553:88872` (dialog group `2553:89341`)
- Confirm Action (mark-all-read) modal frame: `2553:95231` (dialog group `2553:95700`)
- Delete Thread modal frame: `2553:94730` (dialog group `2553:95199`)
- Add Reason for Suspension modal frame: `2553:89372` (modal group `2553:89841`)

## Annotations / notes

- **Node-numbering correction**: the task brief for this pass described the "Add Reason for Suspension"
  modal as living inside the main Members table frame (`2553:85074`, "-93") at text nodes
  `2553:89844`–`89867`. On inspection, `2553:85074`'s subtree does **not** contain any "suspension"/
  "reason" text at all. The modal actually lives in a different top-level frame, `2553:89372`
  ("MacBook Pro 14\" - 100"), which is otherwise a near-duplicate of the Members table (confirmed via
  its own "Member Management" heading text). This frame ID had been provisionally earmarked elsewhere
  as an `import-csv` step, but its actual content is Members + this modal, not a CSV screen — see the
  matching note in `import-csv/styling.md`. All screenshots and node IDs above reflect the corrected,
  verified location.
- **Reused confirm-dialog component**: `modal-delete-user.png`, `modal-revoke-suspension.png`,
  `modal-confirm-mark-all-read.png`, and `modal-delete-thread.png` all share an identical visual
  spec (400×275ish card, r16, icon circle, Poppins Bold 16px heading, Cancel + colored action button) —
  strong evidence they're all instances of one reusable confirm-dialog component with swapped copy,
  not four separately designed modals. This repo already has `apps/frontend/src/components/ui/ConfirmDialog.tsx`
  (used in `apps/frontend/src/app/admin/unresolved-threads/page.tsx`) — these Figma variants are almost
  certainly meant to map to that same component with different title/body/button-color props.
- **Contextual mismatches**: `modal-confirm-mark-all-read.png`'s body text — "This action will mark all
  messages as read. Do you want to continue?" — doesn't belong on the Members page; it reads like the
  "mark all replied" action from the Unreplied Threads screen, reused here as a generic prototype
  instance. Likewise `modal-delete-thread.png`'s "Delete Thread?" copy has nothing to do with deleting a
  member — deleting a "thread" belongs on a posts/threads page, not Members. Both are almost certainly
  the same reusable confirm-dialog prototyped on a convenient (but contextually wrong) backdrop copy,
  rather than intentional Members-page features.
- **`modal-suspend-reason.png` is NOT mismatched**: unlike the two above, this modal's copy ("Add Reason
  for Suspension") is thematically correct for the Members page (suspending a member) — its backdrop
  (a Members-table duplicate) matches its content, just with an unexpected/incorrect frame ID as noted above.
- Inter-font heading usage (`Add Member`, `Extend Subscription`, `Add Reason for Suspension`) is flagged
  consistently with the file-wide "Inter leaking in from a later iteration" note in `design-tokens.md`.
