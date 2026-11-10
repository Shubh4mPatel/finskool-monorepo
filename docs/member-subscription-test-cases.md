# Test cases: admin-added members, plans, renewals, the expiry jobs and imports

Written from reading the code, not from running it. Cases marked **CHECK** are ones where the code looks wrong or
unclear and should be tested first. Nothing here is built yet.

## How it works today (the parts these cases touch)

1. **Admin adds a member** (`POST /admin/members`, or a CSV / Excel row): a `users` row with no password, an
   `approved_phones` row (`pending`), the free-community subscription (100 years) and one paid subscription
   (`valid_until` and `paid_on` are plain dates). A welcome email goes out if there is an email.
   A second community for the same phone goes through **Edit member -> add community** or another sheet row.
   `POST /admin/members` again for that phone is a `409`.
2. **The member registers in the app** with the same phone (OTP on WhatsApp). The existing row is claimed: name, email
   and password are written, `approved_phones` becomes `registered`, the free community is ensured. Subscriptions are
   not touched. (Google / Apple does the same after the phone OTP.)
3. **Login / app access**: login needs at least one active subscription with `valid_until >= today`. The communities
   the app shows are the active, unexpired ones, read live.
4. **Admin renews** (`POST /admin/subscriptions/:id/extend`): the old row becomes history, a new active row is written
   with an absolute new `valid_until`, then an inbox row, live event, push and email.
5. **Cron** (`cron.ts`, schedulers in Asia/Kolkata): 02:00 `expireLapsedSubscriptions` (closes rows with
   `valid_until` before today and tells the member), 09:00 `runSubscriptionLifecycleSweep` (7-day, 1-day and
   "expired" reminders, one per subscription row and type). "Today" in both is the server's local midnight; the
   containers have no `TZ` set, so that is **UTC**.
6. **Web import**: the browser reads the file (`xlsx`), `POST /admin/validate-import` previews, `POST /admin/import-json`
   saves. `POST /admin/import-csv` is the older server-side path with its own parsing.

## A. Admin adds a member, then the member registers

| # | Case | Expected |
|---|---|---|
| A1 | Admin adds Priya to community X (paid), she registers with that phone | Same user id, X is listed in the app, free community too, password works |
| A2 | Admin gave her X, Y and Z (one add + two "add community"), she registers | All three listed, each with its own expiry date |
| A3 | Same, but Y's date is already past | X and Z listed, Y not listed; no error |
| A4 | All of the admin's communities are past, she registers | Login works through the free community; paid ones not listed |
| A5 | She registers with a different email than the admin typed | Email becomes the one she typed, plan untouched (admin's record is still shown in the roster) |
| A6 | She registers with an email that belongs to another member | `409 EMAIL_TAKEN`, nothing written |
| A7 | She registers with a phone typed differently (`9876543210`, `+91 98765 43210`, `098765-43210`) | Same account is found |
| A8 | Admin suspended or deleted her before she registered | Registration refused (`PHONE_INACTIVE`); admin revive then works |
| A9 | Admin adds her, then deletes her, then adds the phone again | Revive prompt, then she is back with the new plan only |
| A10 | Two people register with her phone at once | One account, one wins, the other gets a clean conflict |
| A11 | She starts registration, admin edits her phone, she confirms the OTP | Defined behaviour (conflict or claim), never a second account |
| A12 | She registers with Google/Apple after the admin added her (same phone) | Same account, plan intact (covered by the social login tests) |
| A13 | A different person registers with her email first (self sign-up), then the admin adds her phone with that email | Clear conflict to the admin, no merge |
| A14 | Notifications that were created before she registered (admin added, sweep ran, extension) | Decide: shown after she registers, or hidden; no push was possible before |
| A15 | She registers, then the admin adds community W | W appears in the app without logging in again |
| A16 | Admin adds her with no email | Registers fine; no email events fail; sweep writes the inbox row only |
| A17 | After registration `approved_phones.status` and the admin roster | `registered`, source `admin`, plan shown |
| A18 | **CHECK** Admin roster "current subscription" for a member with a free and a paid community | Should be the paid one; the code takes the newest-created row, which can be the free one (created later at login for old accounts) |

## B. Admin extends a subscription

| # | Case | Expected |
|---|---|---|
| B1 | Extend an active subscription of a registered member | New row active, old inactive, one active row per community, app shows the new date |
| B2 | Extend an admin-added member who has not registered yet | Works; she sees the new date after registering |
| B3 | Extend a lapsed row that is still `is_active` (cron has not run) | Works, one active row |
| B4 | Extend a row the cron already closed (`is_active = false`) | Works, one active row (the old closed row stays history) |
| B5 | Extend a row that is history (a newer active row exists) | Defined: the newest request wins, still one active row |
| B6 | New `validUntil` earlier than the current one | Allowed or refused, by decision; either way one active row |
| B7 | `paidOn` after `validUntil`, equal, or in the future | Refused for after / equal; future `paidOn` decided |
| B8 | **CHECK** `paidOn` backdated earlier than the old row's creation (admin enters last week's payment date) | The new row is stamped `createdAt = paidOn`, so the roster, which picks the newest `createdAt`, can keep showing the OLD row (expired). Must show the new one |
| B9 | Extend a member who was suspended | Allowed? the member stays blocked; reminder rules still skip suspended |
| B10 | Extend a deleted member | `409 MEMBER_DELETED` |
| B11 | Community admin extends a row of a community they manage / do not manage | Allowed / `403` |
| B12 | Two admins extend the same row at once | One active row (covered) |
| B13 | After extending, are old reminders re-sent? | New row = new reminder cycle; old row's keys never fire again |
| B14 | After extending, the member's inbox, live event, push and email | One of each; email only if there is an address |
| B15 | Extend on the last day, and extend on the day after `valid_until` | Both fine; member never loses access if done before 05:30 IST (see H1) |
| B16 | Payment `0`, negative, huge, text | `4xx`, nothing written (covered) |
| B17 | Dashboard revenue and "expiring in 7 days" counts after a renewal | Revenue counts the new payment once; the member leaves the "expiring" list |
| B18 | Member paid online (plan purchase) while the admin extends the same community | One active row; receipt unaffected |

## C. The expiry job (02:00) and the reminder sweep (09:00)

| # | Case | Expected |
|---|---|---|
| C1 | Row with `valid_until` yesterday, active | Closed, member told once (inbox, push, email) |
| C2 | Row with `valid_until` today / tomorrow | Untouched by the expiry job; "last day" reminder only |
| C3 | Row exactly 7, 6, 2 days away | 7-day reminder (once per row) |
| C4 | Row exactly 1 and 0 days away | 1-day reminder (once per row) |
| C5 | Row 8+ days away | No reminder |
| C6 | Sweep runs twice the same day | No duplicates (inbox, push, email) |
| C7 | Sweep skipped for two days | Next run still catches rows inside the 7-day windows |
| C8 | Row expired 3 days ago and the job missed it | Closed and told on the next run, once |
| C9 | Row expired 30 days ago and the job never ran | Closed silently or told, by decision; never crashes |
| C10 | Member renewed on day 5 of the 7 | Reminders stop; no "expired" message for the old row |
| C11 | Admin-added member, not registered, no email | Inbox row only; nothing throws; no push (no token) |
| C12 | Admin-added member with email, not registered | Email goes out; wording works for someone who never logged in |
| C13 | Suspended or deleted member with an expiring row | No reminder; the row is still closed |
| C14 | Member with three communities expiring on different days | Each community gets its own messages, routing opens the right community |
| C15 | Free-community row (100 years) | Never notified, never closed |
| C16 | Email send fails | Inbox row stays, row is closed, the next row is still processed; failure logged |
| C17 | Closing fails for one row (database error) | Others continue, this one retried tomorrow, not told twice |
| C18 | Push token dead or missing | Skipped without failing the job |
| C19 | 5,000 rows due at once | Finishes without holding the worker for long; no memory blow-up |
| C20 | Two cron containers running (a rolling deploy) | No duplicate messages (the dedupe key holds) |
| C21 | A row imported already past its date (lapsed customers backfilled) | Decide: closed quietly. Today the new member gets "Access paused" the next 02:00 |
| C22 | After the row is closed: login, community list, feed, ticket creation | Community gone, free tier still works, `SUBSCRIPTION_EXPIRED` only if nothing active |
| C23 | After expiry, the admin roster status | Shows expired, `hasActiveSubscription: false`, filter "expiring"/"expired" correct |
| C24 | Notification deep link of an "expired" message | Opens the right community's renew info |

## D. Time and calendar (cron and "today")

| # | Case | Expected |
|---|---|---|
| D1 | **CHECK** Last valid day D (IST). Expiry job at 02:00 IST on D+1 | The job computes "today" in UTC (D, 20:30 UTC of the previous day), so it does **not** close D until the run after. Closing should happen at the first run after midnight IST |
| D2 | **CHECK** Member opens the app 00:00 to 05:30 IST on D+1 | Server "today" is still D in UTC, so access is still granted until 05:30 IST. Cut-off should be midnight IST |
| D3 | The sweep at 09:00 IST on each of D-7 .. D+1 | Reminder buckets match the dates the admin sees in IST |
| D4 | Admin enters `2030-06-30`: stored as date, shown as 30 Jun in the roster, the app, emails | Same day everywhere (no off-by-one) |
| D5 | Renewal on 29 Feb, month-end dates, year change | Dates correct |
| D6 | Server clock in IST instead of UTC (a developer machine) | Same results as in production |
| D7 | Daylight-free India, but test the 18:30 UTC to 00:00 IST window with fake timers | No double or missed notification around midnight |

## E. CSV / Excel import

| # | Case | Expected |
|---|---|---|
| E1 | New phone, community, payment, valid date | User + approved phone + free + paid subscription; welcome email if email; admin gets the import summary |
| E2 | The imported member then registers | Claims that row, sees the imported community (this is A1 through a sheet) |
| E3 | Same phone on two rows, two communities | One user, two subscriptions |
| E4 | Same phone twice for the same community | The **(phone, community) pair is the duplicate**: the second row is skipped (or updates, by strategy); the preview flags it. The same phone in another community is not a duplicate |
| E5 | Existing registered member, new community | Subscription added, free ensured, member untouched |
| E6 | Existing member, same community, `skip` / `overwrite` | Untouched / dates and payment updated, active row count stays one |
| E7 | **CHECK** `overwrite` edits the active row in place instead of writing a new period | No history is kept; revenue and "paid on" change retroactively. Decide if intended |
| E8 | Suspended / deleted member in the sheet | Skipped unless the admin ticked "revive"; a revived deleted member returns with the new plan only |
| E9 | Date `30/06/2026` (Indian day-first) | Refused with `Valid must be YYYY-MM-DD (got "30/06/2026")`, in the preview and at save |
| E10 | Date `06/07/2026` (6 July in India) | Refused, never guessed: dates are exactly `YYYY-MM-DD` and a real day (`2026-02-31`, `2026-2-3` are refused too) |
| E11 | Date without a year (`9 June`) | Refused (not `YYYY-MM-DD`), on the file, the preview and the reviewed-rows import alike |
| E12 | Excel date cells (serial numbers, formatted cells, text cells) | A cell Excel holds as a date (`.xlsx`) is read as that calendar day in any server timezone; text must be `YYYY-MM-DD`. A CSV is read as written (no serial numbers) |
| E13 | Preview (`validate-import`) checks `Valid` and `Paid on` with the same strict rule as the save | A bad date shows in the preview, not only at save. **Still open:** payments over the limit and names over 100 characters are only caught at save |
| E14 | `valid` earlier than `paidOn`, `valid` in the past | Refused or imported as already expired, by decision (see C21) |
| E15 | Payment with currency symbol, commas, decimals, `-5`, `1e3`, `10+5` | `1,000` ok; expressions and minus refused (the page and the server must agree) |
| E16 | Phone formats (`98111 22222`, `+91-...`, `0...`, with country code, 11 or 9 digits, letters) | Normalised or a row error |
| E17 | Email blank, uppercase, spaces, duplicate inside the sheet, owned by another member | Blank stays null; the rest normalised or a row error; file never aborts |
| E18 | Service name with different case, trailing space, a deleted community, a community the admin does not manage | Match ignoring case and spaces; the others are row errors |
| E19 | Header with BOM, extra spaces, different order, missing column, extra columns, empty file, header only | Works / clear error, never a crash |
| E20 | 1,000 rows, then 10,000 rows | Completes; progress or timeout behaviour is defined (the web path is one request) |
| E21 | Two admins import overlapping sheets at once | No duplicate users, no 500 |
| E22 | Import twice (the admin clicks the button twice) | Second run is all skipped; nothing doubled |
| E23 | Row fails halfway (database error) | Earlier rows stay saved and are reported; the failed row is listed with a safe reason |
| E24 | Imported member's welcome email | Right name, phone, community, valid-till; none if no email |
| E25 | Imported member appears in the roster, search, export, dashboard totals | Yes, source `admin`, registration `pending` |
| E26 | A community admin imports | Only their communities; rows for others are errors (covered) |
| E27 | Imported subscription gets `paid_on` empty | Roster, revenue and CSV export show a sensible value (falls back to creation date) |
| E28 | After import, reminders and expiry apply to these rows | Same rules as any row (sweep, expiry) |
| E29 | Export CSV, then import that same file | Same column names (`Name, Contact Number, Payment, Paid on, Valid, Service, Email`, plus the extra `Status, Added On`), plain payment, `YYYY-MM-DD` dates: no row errors, nothing duplicated |
| E30 | Free community row: payment `0` or blank, `Valid` blank | Accepted. A new member gets the free community once; a member who has it is skipped; no welcome email (no expiry to state) |
| E31 | Free community row with a price above 0, or a paid community with payment `0` or blank | Row error (`The free community has no price...` / `Invalid payment amount`) |
| E32 | `Paid on` in another format | Row error (it used to be dropped silently) |
| E33 | CSV exported before this change (headers `Phone`, `Community`, `Valid Till`, `₹12,500`) | Not accepted: one set of column names; rename the headings |

## F. Other connections to keep in mind

| # | Case | Expected |
|---|---|---|
| F1 | Admin removes one community from a member | That row closed, the others stay, member told |
| F2 | Admin removes the last paid community | Free tier still works, login still works |
| F3 | Member suspended, then revoked, with an expiry in between | After revoke the app shows only still-valid communities |
| F4 | Admin changes the member's phone before registration | Registration works with the new phone, not the old |
| F5 | Admin deletes a community that members are subscribed to | Their rows stay but the community is hidden; no reminders for it; the sweep does not crash on a deleted community |
| F6 | Member buys a plan online while the admin gave the same community | One active row; the later payment extends from the later end date |
| F7 | Plan price changed after the admin renewed | Old payments unchanged |
| F8 | Dashboard "active members", "expiring in 7 days", revenue after each of the above | Counts match the roster |
| F9 | Push and live events for admin actions reach a logged-in member and a member who is not logged in | Logged in: both; not logged in: inbox only |
| F10 | A community admin watches a member in two communities when one expires | Roster shows the member under both, each with its own status |
