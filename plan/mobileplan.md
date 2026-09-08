# Admin members: surface self-registered users + split status fields

## Context

Earlier in this project, self-serve mobile registration was reworked so a *brand-new* self-registered user (nobody added their phone first) gets only a `User` row — no `ApprovedPhone` row is created for them. That fixed a registration bug, but it had a side effect nobody had traced through yet: **every admin member-management surface is built entirely on `ApprovedPhone`**, so self-registered users are completely invisible to `GET /admin/members`, the member detail page, and every suspend/delete/reset-password/edit action — they can't be seen, filtered, searched, or managed by an admin at all today.

The user wants three things on the members API:
1. A filter distinguishing admin-added members from self-registered ones — which requires actually making self-registered users show up in the list first.
2. The merged 5-value `status` field split into two: the account's own standing (from `User.status`: active/suspended/deleted) and registration progress (from `ApprovedPhone.status`: pending/registered — `null` for self-registered members, who have no `ApprovedPhone`).
3. "Expired" split out as its own field (subscription validity), decoupled from account status — because a forthcoming free-community tier means "no active paid subscription" won't mean anything is wrong with the account.

Scope was explicitly widened (user's call) from "list-only" to **full member management**: suspend, delete, reset-password, edit, and the detail page must all work for a self-registered user too, not just the list.

No Prisma schema/migration changes are needed — this is entirely an application-layer (service/DTO/controller/frontend) change.

## Key architectural finding

`Subscription.approvedPhoneId` is a required, non-nullable FK, while `User` already has a real Prisma relation `subscriptions Subscription[]` (unlike `User`↔`ApprovedPhone`, which is phone-string-matched only, no formal relation). This means:
- The member list/detail queries can be **flipped to be `User`-primary** instead of `ApprovedPhone`-primary — genuinely simpler, not just symmetric.
- Any place that needs to *create* a `Subscription` for a self-registered member (`updateMember`'s "add to a new community" flow) must lazily create an `ApprovedPhone` row first, since the FK requires it. **Accepted consequence, not fixed here**: the moment an admin grants a self-registered member their first admin-managed community, they permanently flip from `source: 'self'` to `source: 'admin'`. A future free-community feature that wants to avoid this would need `Subscription.approvedPhoneId` to become nullable — out of scope now.

## 1. Identity/addressing scheme

Switch the primary key everywhere from `approvedPhoneId` to `userId`:
- `MemberItemDTO.id` becomes `User.id` (was `ApprovedPhone.id`). Add `approvedPhoneId: string | null`, present only when `source === 'admin'`.
- Route paths stay **textually identical** (`GET/PATCH/DELETE /admin/members/:id`, `/suspend`, `/revoke`, `/password`, `/communities/:communityId`) — only what `:id` *means* changes. The frontend already treats `params.id`/`member.id` as an opaque string passed straight back into API calls, so no frontend routing logic needs to change, only status-badge rendering.
- **Old bookmarked links to `/admin/members/{old-approvedPhoneId}` will 404 after this ships** (different UUID space). Accepted, not worked around — this is an internal admin tool, backend+frontend deploy together.
- `getApprovedPhoneIdForUser` (`admin.service.ts`), its controller `getMemberByUserId`, and the route `GET /members/by-user/:userId` become dead code — **delete them**. Their entire purpose was resolving `userId → approvedPhoneId` so `PostThreads.tsx` could route into the (approvedPhoneId-keyed) detail page; once the detail page is userId-keyed, that resolution step is unnecessary. This is also a **bug fix**: today, clicking "view member" on a comment from a self-registered author always 404s.

**New required guard**: once lookup is userId-based, an admin's own `userId` (or another admin's) could be passed to any of these endpoints. Today only `suspendMember`/`deleteMember`/`getApprovedPhoneIdForUser` guard against targeting an admin account (verified: `admin.service.ts` lines ~1368, ~1412, ~1803) — `fetchMemberDTO`, `updateMember`, `revokeSuspension`, `resetMemberPassword`, `revokeMemberCommunity` do not, because it was moot before (an admin's phone essentially never matched an `ApprovedPhone` row). **Every one of these 7 functions needs `if (!user || user.role === 'admin') throw new NotFoundError('Member not found')` right after the `User` lookup**, or an admin account becomes viewable/editable/suspendable through this API.

## 2. Query restructuring — `listMembers` / `queryMembers` / `buildMemberWhere`

All in `apps/backend/src/modules/admin/admin.service.ts`. Flip the driving table from `db.approvedPhone` to `db.user`:

```ts
private async queryMembers(userWhere, currentSubIds, pagination?) {
  const [total, rows] = await Promise.all([
    pagination ? this.db.user.count({ where: userWhere }) : Promise.resolve(null),
    this.db.user.findMany({
      where: userWhere,
      orderBy: { createdAt: 'desc' },
      ...pagination,
      include: {
        subscriptions: {
          where: { id: { in: currentSubIds } },
          include: { community: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ])

  // Same batch-Map idiom already used elsewhere in this file, just reversed.
  const approvedPhones = await this.db.approvedPhone.findMany({ where: { phone: { in: rows.map(u => u.phone) } } })
  const apByPhone = new Map(approvedPhones.map(a => [a.phone, a]))

  const members = rows.map(u => {
    const ap = apByPhone.get(u.phone) ?? null
    const sub = u.subscriptions[0] ?? null
    return {
      id: u.id,
      approvedPhoneId: ap?.id ?? null,
      source: ap ? 'admin' : 'self',
      // IMPORTANT: keep this precedence — do not switch to User fields as source of truth.
      name: ap?.name ?? u.name,
      phone: ap?.phone ?? u.phone,
      email: ap?.email ?? u.email,
      avatarUrl: u.avatarUrl,
      accountStatus: u.status,
      registrationStatus: ap?.status ?? null,
      hasActiveSubscription: /* sub && sub.isActive && sub.validUntil >= today */,
      createdAt: u.createdAt.toISOString(),
      suspensionReason: u.status === 'suspended' ? (u.suspensionReason ?? null) : null,
      subscription: sub ? this.buildSubDTO(sub) : null,
      allSubscriptions: u.subscriptions.map(s => this.buildSubDTO(s)),
    }
  })
  return { members, total: total ?? members.length }
}
```

**Non-obvious but important**: keep `ap?.name ?? u.name` / `ap?.email ?? u.email` precedence. `importUsers`'s overwrite-strategy deliberately updates `ApprovedPhone.name/email` on every re-import but only touches `User.name/email` if the member hasn't registered yet (`!existingUser.passwordHash`) — so `ApprovedPhone` is the deliberate "admin's view of record" and can genuinely diverge from `User` post-registration. Silently switching the DTO to always read `User` fields would change what already-registered admin-added members display, for no reason connected to this change.

`buildMemberWhere` rewrite — base filter becomes `{ role: 'member', deletedAt: null }`, **replacing** the current separate `db.user.findMany({where:{role:'admin'}})` + `notIn` phone hack — fewer queries, provably correct instead of a heuristic.

- `communityId`/`communityIds`/`validFrom`/`validTo`/`paidFrom`/`paidTo`/`expiringIn7Days` — same logic, now via `userWhere['subscriptions']` (a real relation) instead of phone-matched `ApprovedPhone.subscriptions`.
- `search` — now matches `User.name/email/phone` instead of `ApprovedPhone.*`. Self-registered users become searchable (the point of this whole change); admin-added members stay matchable except in the post-registration-rename edge case above (acceptable).
- Old single `status` (5-value) filter is replaced by four independent filters:
  - `accountStatus: 'active'|'suspended'|'deleted'` → direct `userWhere['status']` (now a top-level filter since `User` is primary — simpler than today's suspended/deleted branch).
  - `registrationStatus: 'pending'|'registered'` → fetch `ApprovedPhone.findMany({where:{status}})`, filter `phone: {in: matching}`. **Decided: literal-only** — self-registered members never match this filter (their `registrationStatus` is `null`); use `source` to find them instead.
  - `hasActiveSubscription: boolean` → reuses the exact `subWhere`/`currentSubIds`/`some`/`none` machinery that today implements the registered/expired split, decoupled from `ApprovedPhone.status`.
  - `source: 'admin'|'self'` → fetch all `ApprovedPhone.phone` once (same precedent as `validateImport`'s existing unbounded `approvedPhone.findMany`), `phone: {in/notIn: approvedPhoneSet}`.

**Optional, low-risk**: `getCurrentSubscriptionIds`'s `DISTINCT ON` grouping column could move from `approved_phone_id` to `user_id` — behaviorally a no-op today (every write path sets both together, 1:1) but more consistent with userId-primary addressing and avoids a latent footgun if `approvedPhoneId` ever becomes nullable later (Postgres treats `NULL` as distinct-per-row in `DISTINCT ON`). Do this while touching the file; not required.

## 3. New DTO shape (`apps/backend/src/modules/admin/admin.dto.ts`)

```ts
export interface MemberItemDTO {
  id: string                        // User.id (was ApprovedPhone.id)
  approvedPhoneId: string | null    // present only when source === 'admin'
  source: 'admin' | 'self'
  name: string
  phone: string
  email: string | null
  avatarUrl: string | null
  accountStatus: 'active' | 'suspended' | 'deleted'
  registrationStatus: 'pending' | 'registered' | null
  hasActiveSubscription: boolean
  createdAt: string                 // now User.createdAt uniformly
  suspensionReason: string | null
  subscription: MemberSubscriptionDTO | null
  allSubscriptions: MemberSubscriptionDTO[]
}

export interface MemberListFilters {
  communityId?: string
  communityIds?: string[]
  accountStatus?: 'active' | 'suspended' | 'deleted'
  registrationStatus?: 'pending' | 'registered'
  hasActiveSubscription?: boolean
  source?: 'admin' | 'self'
  validFrom?: string; validTo?: string
  paidFrom?: string; paidTo?: string
  expiringIn7Days?: boolean
  search?: string
  page: number; pageSize: number
}
```

**Clean cutover** — drop the old `status`/`isActive`/`isRegistered` fields entirely rather than keeping them for compat. No third-party consumers of this API exist (verified by grep); keeping the old merged field would just reintroduce the exact conflation this change exists to remove (a self-registered member with no subscription would have to lie and say `expired`).

`MemberStatus` (currently exported, used by CSV + old filter) → demote to a private, non-exported label used only inside `membersToCsv` for a human-readable "Status" column.

Small result DTOs flip nullability: `DeleteMemberResultDTO`/`SuspendMemberResultDTO`/`RevokeSuspensionResultDTO`'s `userId` becomes always-present, `approvedPhoneId` becomes the nullable one. `BulkDeleteMembersDTO.approvedPhoneIds` → `userIds`; `BulkDeleteMembersResultDTO.errors[].approvedPhoneId` → `userId`.

## 4. Rewiring the mutation functions + `fetchMemberDTO`

All in `admin.service.ts`. Pattern: `db.user.findUnique({where:{id: userId}})` → admin-role guard (section 1) → batch-fetch `ApprovedPhone` by phone only when needed for `approvedPhoneId`/`source` in the response.

- **`suspendMember(userId, reason)`**, **`revokeSuspension(userId)`** — trivial swap + admin-role guard where missing. `User.status` already supports suspending regardless of `ApprovedPhone` existence — works unchanged for self-registered members.
- **`deleteMember(userId)`** — swap primary lookup to `User`; the current "ApprovedPhone exists but no matching User" defensive branch (logged as "shouldn't happen") is deleted — under userId-primary addressing, "User exists, no ApprovedPhone" is the *normal* self-registered case, not an error.
- **`resetMemberPassword(userId, newPassword)`** — trivial swap, already only touches `User.passwordHash`. Works unchanged for self-registered members.
- **`bulkDeleteMembers(userIds)`** — rename param, same per-id delegation.
- **`fetchMemberDTO(userId)` / `getMemberById(userId)`** — rewrite to `db.user.findUnique` + admin-role guard + single `ApprovedPhone` lookup by phone; feed `latestSubscriptionPerCommunity` with `user.subscriptions` instead of `ap.subscriptions`.
- **`revokeMemberCommunity(userId, communityId)`** — simplifies: the current extra `db.user.findUnique({where:{phone: ap.phone}})` hop disappears since `userId` is now the primary key. The existing "don't auto-deactivate the account on last-community-loss" comment is unaffected and stays as-is.
- **`updateMember(userId, data, adminId)`** — needs a new `adminId` parameter (current signature has none — controller must pass `req.user!.id`).
  1. Look up `User`, admin-role guard, look up `ApprovedPhone` by phone (nullable).
  2. Phone-conflict check moves to `db.user.findUnique({where:{phone}})` excluding self by id.
  3. Basic edits (no `newCommunity`): update `User` only, do not create an `ApprovedPhone`. `source` stays `'self'`.
  4. `newCommunity` present and `ap` is null: lazily `tx.approvedPhone.create` (`status: 'registered'` — not the default `pending`, since this person already has a password; `addedBy: adminId`) before creating the subscription. Comment clearly why (FK requirement, not a product choice) and that this flips `source` to `'admin'` going forward.

### Bug this refactor would introduce if not fixed: `reviveMember`

`reviveMember`'s `tx.approvedPhone.update({where:{phone}, ...})` is an **update**, which throws if no row exists. Today that's always safe because only admin-added members could reach suspended/deleted at all. Once suspend/delete work for self-registered users too (required by this plan), a self-registered user can become suspended/deleted with **no `ApprovedPhone` row**. Reviving them via `addMember` → `MEMBER_REVIVE_REQUIRED` → `reviveAndAddMember` → `reviveMember` would then crash (Prisma P2025, no matching row).

**Fix**: change `reviveMember`'s `approvedPhone.update` to `approvedPhone.upsert({where:{phone}, create:{phone, name, email, status:'pending', addedBy: adminId}, update:{name, email, status:'pending', addedBy: adminId}})`.

### Bulk-import revive-widening (in scope per user's decision)

`importUsers`/`importUsersFromJSON`'s revive-detection branches currently gate on `existingUser && existingAp` — a self-registered-then-suspended/deleted phone has no `existingAp`, so it falls through to the "brand new user" branch and hits `tx.user.create` on a phone that already exists → a Prisma unique-constraint error. Widen the condition to just `existingUser && existingUser.status !== 'active'` (drop the `existingAp` requirement), and apply the same `reviveMember` upsert fix so the branch works whether or not an `ApprovedPhone` already existed. Verify `importUsers`'s (CSV/XLSX path) per-row error handling actually catches this the same way `importUsersFromJSON` does — check there's a try/catch around this section in both, not just the JSON path.

## 5. Migration/rollout ordering

No Prisma migration needed. DTO shape and route-parameter *meaning* change together and atomically — old frontend would break against new backend and vice versa — so land backend + frontend as **one coordinated PR** (same monorepo, deploy together anyway):

1. Backend, in dependency order: `admin.dto.ts` → `admin.service.ts` (queries, 7 mutation functions, `reviveMember` fix, bulk-import widening) → `admin.controller.ts` (pass `req.user!.id` into `updateMember`, rename bulk-delete schema field) → `admin.routes.ts` (delete the `by-user/:userId` route).
2. Frontend, same PR: `memberFormat.ts` (new shape + split label/style maps), `members/page.tsx` (filter UI, status rendering, bulk-delete payload key, stat-card query params), `members/[id]/page.tsx` (status rendering only — fetch/routing mechanics are already opaque-id-based, unchanged), `PostThreads.tsx` (drop the `by-user` lookup, direct `router.push`).
3. Optional independent pre-step: the `getCurrentSubscriptionIds` groupby-column swap is backend-only and behaviorally a no-op today — can land separately first if useful to shrink the main diff.
4. No data backfill needed — this only changes how existing rows are queried/addressed, not the rows themselves.
5. Doc update: `mobile-auth.service.ts`'s `finalizeRegistration` comment currently states self-registered accounts "can't be suspended, password-reset, or granted a community subscription from the admin side" — becomes false after this ships, update for accuracy (doc-only).

## 6. Frontend changes

- **`apps/frontend/src/lib/memberFormat.ts`**: new `MemberItem` interface matching section 3; split `STATUS_STYLES`/`STATUS_LABELS` into `ACCOUNT_STATUS_*` (active/suspended/deleted), `REGISTRATION_STATUS_*` (pending/registered), plus a `SOURCE_LABELS` map (admin/self). Consider one small derived-badge helper (e.g. `getDisplayStatus(member)`) mirroring the old backend `deriveMemberStatus` purely for a single compact table badge, so the visual footprint stays close to today's while the 3 real fields remain available for filters/CSV.
- **`apps/frontend/src/app/admin/members/page.tsx`**: filter bar gets up to 4 controls (Account Status, Registration, Subscription validity, Source) replacing the single status `<select>`; `m.status === "deleted"/"suspended"` conditionals → `m.accountStatus === ...`; bulk-delete payload `{approvedPhoneIds}` → `{userIds}`; summary stat cards' `status=registered`/`status=pending` queries → `registrationStatus=registered`/`registrationStatus=pending`. Per the confirmed scope, **no action buttons need to be disabled** for self-registered rows — suspend/revoke/delete/reset-password/edit all now genuinely work for them; Extend/Remove-from-community stay conditioned on `sub` existing exactly as today (not a new special case).
- **`apps/frontend/src/app/admin/members/[id]/page.tsx`**: only status-badge/conditional-rendering lines need updating to the 3 new fields; fetch/mutation URLs are unchanged (the `id` in the URL transparently becomes a userId).
- **`apps/frontend/src/components/feed/PostThreads.tsx`**: replace the async `by-user` lookup + `router.push` with a direct `router.push(\`/admin/members/${comment.author.id}\`)`.

## Verification

Manual QA checklist (no automated tests exist for the admin module today):
1. Admin-added member in each state (pending, registered+active, suspended, deleted) — full CRUD via the new userId-keyed routes still works.
2. A genuinely self-registered member (mobile self-serve register + verify-otp, never touched by an admin) — confirm: appears in the list; `source: 'self'`, `registrationStatus: null`; detail page loads; suspend/revoke/delete/reset-password all succeed; `updateMember` without `newCommunity` doesn't create an `ApprovedPhone`; `updateMember` *with* `newCommunity` lazily creates one and `source` flips to `'admin'` afterward.
3. Revive a self-registered-then-suspended member via `addMember` → confirm `MEMBER_REVIVE_REQUIRED` → `reviveAndAddMember` → succeeds (confirms the `reviveMember` upsert fix).
4. Bulk-import (CSV and JSON paths) a row matching a self-registered-then-deleted phone with `reviveRowNums` including it — confirm it revives instead of erroring.
5. An old bookmarked `/admin/members/{oldApprovedPhoneId}` URL 404s cleanly (expected, not a bug).
6. `PostThreads.tsx`'s "view member" link on a comment from a self-registered author now opens their profile instead of 404ing.
7. Filters: each of `accountStatus`, `registrationStatus`, `hasActiveSubscription`, `source` independently, and in combination with `communityId`/date filters, return the expected members.
8. CSV export (`GET /admin/members/export`) still produces a sensible "Status" column via the demoted `MemberStatus` label logic.

Run via `apps/backend`'s dev server + the admin frontend (`npm run dev` in both, or the existing `docker compose -f docker/docker-compose.production.yml` stack used earlier in this project) — no test suite exists to run instead.
