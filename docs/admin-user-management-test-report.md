# Admin user management: test cases, bugs found, bugs fixed

Scope: the admin side of user management in `apps/backend/src/modules/admin`: Roles & Admins (create, re-scope,
delete, grant and revoke community access), members (add, edit, suspend, revoke, delete, bulk delete, revive, extend,
password reset, roster, export), bulk import (CSV, reviewed JSON, pre-flight check), communities and plans (who may
touch them), and the admin inbox of member questions.

## How to run

```bash
cd apps/backend
npm run test:db:up        # throwaway Postgres on :55433 (Docker)
npm test                  # the whole suite
npx vitest run tests/admin   # only the admin tests
```

No Docker? Start any Postgres 16 and point the suite at an empty database whose name ends in `_test`:
`TEST_DATABASE_URL=postgresql://user@localhost:5432/finskool_test npx vitest run tests/admin`.
The payments tests also need `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` set to any value.

## New test files (this round)

| File | Tests | What it covers |
|---|---|---|
| `tests/admin/admins.manage.test.ts` | 50 | Admin creation, re-scoping, deletion, grant and revoke; who is refused (community admin, mobile member, anonymous, stale token); every validation rule; duplicate phone/email in any format and letter case; simultaneous requests; deleted admin cannot log in or refresh; the last super admin cannot be removed |
| `tests/admin/members.security.test.ts` | 64 | A community admin against members of other communities on every member route; admin accounts unreachable through member routes; malformed ids on 17 routes for super and community admins; input limits (length, money, dates, passwords); two admins acting at the same moment |
| `tests/admin/members.import.test.ts` | 29 | CSV upload, reviewed JSON import and pre-flight check: per-row errors, duplicates (skip / overwrite), community scoping, admin phones, deleted communities, wrong files, size limit, revive rows |
| `tests/admin/communities.access.test.ts` | 25 | Community create / edit / delete are super-admin only; plans per community, IDOR attempts through the URL, plan validation; the admin inbox of member questions is scoped to the admin's communities |

Together with the existing admin tests (`admins`, `members.manage`, `members.lifecycle`, `dashboard`, `welcome-kits`,
`banner-ratio`) the admin area now has about 350 tests.

## Bugs found and fixed

| # | Bug | Fix |
|---|---|---|
| 1 | A malformed id in the URL (`/admin/members/abc`) answered **500** on 23 routes (members, subscriptions, communities, plans, admins, comment notifications) | Every id parameter is validated in the controller (`uuidParam`): 400 `Invalid id` |
| 2 | A name over 100 characters, or an email over 255, answered **500** when adding or editing a member, creating an admin, or importing | Limits match the database columns and fail as clear 400s |
| 3 | A name of only spaces was accepted (blank member and blank admin names) | Names are trimmed and need 2 characters |
| 4 | A payment too large for the column answered **500** | Payment capped at 99,999,999 |
| 5 | `2030-13-45` answered **500**; `2030-02-30` was silently saved as 2 March | Dates must be real calendar days |
| 6 | A member could be added or revived into a **deleted** community | Deleted communities are refused (404) |
| 7 | A password of any length was accepted (bcrypt silently cuts it at 72 bytes) | Max 128 characters on admin creation and member password reset |
| 8 | Two requests at once for the same phone or email (add member, create admin, change phone) answered **500** | Clean `409` (and a global safety net turns any unique-key clash into 409) |
| 9 | Four simultaneous renewals of one subscription left **four active subscriptions** in one community | Renewals take a per-member lock and retire every active period first: exactly one active row |
| 10 | Renewing a deleted member's plan "succeeded" but changed nothing the member could use | `409 MEMBER_DELETED` |
| 11 | An access grant to a **deleted admin** was accepted | 404 |
| 12 | CSV import: one row with an email owned by someone else, or a name that was too long, ended the whole upload with **500** after earlier rows were already saved | Each row succeeds or reports its own error |
| 13 | CSV import turned `-5` into a payment of 5 | A minus sign makes the row invalid |
| 14 | Import (CSV and JSON) with an **admin's phone** gave the admin account a subscription and could rename it | The row is rejected: "belongs to an admin account" |
| 15 | Import accepted a **deleted** community (the pre-flight check already refused it) | Both importers use live communities only |
| 16 | A CSV over 5 MB answered **500**; malformed JSON answered **500** | 413 and 400 |
| 17 | Import errors showed the raw database message to the admin | Short, safe reasons; the detail goes to the log |
| 18 | The same community listed twice when creating or re-scoping an admin gave a confusing error | Explicit "listed twice" 400 |
| 19 | Two super admins deleting each other at once could leave **no super admin** | Serialised; the last super admin is protected (`409 LAST_SUPER_ADMIN`) |
| 20 | The Swagger comment I wrote for Google sign-in had a YAML error that broke the API docs | Quoted |

What held up under attack (tests pass, no change needed): a community admin cannot read, edit, suspend, delete,
reset the password of, extend or revive a member of another community, nor add anyone to another community; the 403 leaks
nothing about the member; admin accounts cannot be reached through any member route; plan IDOR through the URL is
refused; a deleted admin cannot log in or refresh; creating an admin can never produce a super admin.

## Open points that need a decision (not changed)

| # | Finding | Options |
|---|---|---|
| F1 | A community admin who deletes a member that is also in a community they do not manage ends **all** that member's subscriptions and marks the account deleted. The test is written and skipped (`members.security.test.ts`) | (a) Keep: delete is account-wide. (b) A community admin only removes the member from their own communities; only a super admin (or "no other active community") deletes the account |
| F2 | Admin sessions are checked from the token only. A **deleted** admin, or one whose communities were changed, keeps the old access until their access token expires (15 minutes by default) | Accept the 15 minutes, shorten it, or check the database on admin-management routes |
| F3 | A deleted admin's email and phone stay reserved forever, and there is no way to restore the account from the dashboard | A "restore admin" action, or free the email/phone on delete |
| F4 | No API promotes or demotes a super admin (only the database) | Add a super-admin-only toggle with the same last-super-admin guard |
| F5 | The members CSV export is not limited to the admin's communities (documented product decision) | Confirm it is still wanted |
| F6 | Changing an admin's communities replaces the whole list, so two admins editing the same person at once: the last save wins | Fine for now; add a version check if it matters |
