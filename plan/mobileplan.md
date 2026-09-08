# Admin members: surface self-registered users + split status fields

## Context

Earlier in this project, self-serve mobile registration was reworked so a *brand-new* self-registered user (nobody added their phone first) gets only a `User` row — no `ApprovedPhone` row is created for them. That fixed a registration bug, but it had a side effect nobody had traced through yet: **every admin member-management surface is built entirely on `ApprovedPhone`**, so self-registered users are completely invisible to `GET /admin/members`, the member detail page, and every suspend/delete/reset-password/edit action — they can't be seen, filtered, searched, or managed by an admin at all today.

The user wants four things on the members API:
1. A filter distinguishing admin-added members from self-registered ones — which requires actually making self-registered users show up in the list first.
2. The merged 5-value `status` field split into two: the account's own standing (from `User.status`: active/suspended/deleted) and registration progress (from `ApprovedPhone.status`: pending/registered — `null` for self-registered members, who have no `ApprovedPhone`).
3. "Expired" split out as its own field (subscription validity), decoupled from account status — because a forthcoming free-community tier means "no active paid subscription" won't mean anything is wrong with the account.
4. The list sorted by name, ascending — replacing today's `createdAt: 'desc'` — now that it's a mixed admin-added + self-registered list, "newest first" is a less useful default than alphabetical.

Two clarifications on (1) and (2)'s filters, stated explicitly since they're easy to get subtly wrong:
- The **source filter** (`admin` | `self`) is the only way to isolate self-registered members — they can never be found via `registrationStatus`, since that field is `null` for them (see below).
- The **registrationStatus filter** (`pending` | `registered`) is, by construction, admin-added-only: a self-registered member has no `ApprovedPhone` row, so it can never have a `registrationStatus` of `pending` or `registered` to match against. Applying this filter therefore implicitly restricts the result set to `source: 'admin'` members — no separate `source: 'admin'` also needs to be passed alongside it, and passing it explicitly should be a harmless no-op, not a different result set.

Scope was explicitly widened (user's call) from "list-only" to **full member management**: suspend, delete, reset-password, edit, and the detail page must all work for a self-registered user too, not just the list.

**Correction to the line below** (was true when first written, no longer is): this now needs one schema migration — see §0.1. Everything else in this document is still application-layer only.

## §0. Three findings from pre-implementation review, and how they're resolved

A pre-implementation edge-case pass surfaced three problems bigger than "reviveMember crashes." All three are resolved here (user's decisions), before the rest of this plan (§1 onward) is implemented.

### §0.1 — Self-registered members could never log in, on either platform, ever

`Subscription.approvedPhoneId` was a **required** FK. A self-registered user has no `ApprovedPhone` row at all (confirmed in `mobile-auth.service.ts`'s own comment on `finalizeRegistration`), so they could never have *any* subscription — and both `auth.service.ts:217` (web) and `mobile-auth.service.ts:241` (mobile) `login()` reject any non-admin with no active subscription (`SUBSCRIPTION_EXPIRED`). Net effect: register → verify OTP → account created → **every login attempt fails, forever**, until an admin who couldn't even find them (the bug §1–§6 fixes) manually grants a subscription.

**Resolution (user's decision) — two parts:**

**1. Decouple `Subscription` from `ApprovedPhone` entirely** — it maps to `User` directly (already has `userId`); `User`↔`ApprovedPhone` stays phone-string-matched as it already is everywhere else in this codebase (no formal relation needed).

- `schema.prisma`: remove `Subscription.approvedPhoneId`, its `@map`, its relation field `approvedPhone ApprovedPhone @relation(...)`, its `@@index`, and the back-relation `subscriptions Subscription[]` on `ApprovedPhone` (kept only if still referenced elsewhere — grep confirms it isn't used outside this FK). New migration: `ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_approved_phone_id_fkey, DROP COLUMN approved_phone_id;` + drop its index.
- **Every** call site that currently sets `approvedPhoneId` on a `Subscription` create needs that field dropped from the `data` object. Exhaustive list from a full-repo grep (`admin.service.ts` only — nothing outside it writes this column): lines **207, 226-230, 244, 346, 363-366, 374, 1153-1157, 1220-1224, 1276** (this last one is `extendSubscription`'s renewal-row create, easy to miss since it's far from the others). `reviveMember`'s return type drops `approvedPhoneId` too (§1 already restructures this function's signature for the userId-primary flip — merge these changes rather than doing two passes).
- `getCurrentSubscriptionIds`'s raw SQL (`admin.service.ts:1734-1738`) currently does `DISTINCT ON (approved_phone_id, community_id) ... ORDER BY approved_phone_id, community_id, created_at DESC` — this **must** change to `user_id` or it won't compile against the new schema at all. §1's own text called this swap "optional, low-risk" — it is no longer optional; it's a hard requirement of this section.
- `MemberSubscriptionDTO` never exposed `approvedPhoneId` to begin with (verified) — no DTO change needed there.

**2. A free/default community, auto-subscribed at self-registration**, so a brand-new self-registered account has *something* to satisfy the login gate immediately, without needing an admin to do anything:

- `schema.prisma`: add `isFree Boolean @default(false)` to `Community` (a typed flag, not a magic slug/name string match — consistent with how every other fixed-category thing in this schema is modeled). One migration seeds exactly one such row (a real `Community`, created the same way `createCommunity` makes any other — name/slug decided at implementation time, e.g. "Free" / "free").
- `mobile-auth.service.ts`'s `finalizeRegistration` — **only** in the brand-new-phone branch (no `existingUserId`; the `existingUserId` branch means an admin already added them to a real paid community via `addMember`, so they already have a subscription and don't need this): after `tx.user.create(...)`, look up the free community (`tx.community.findFirst({ where: { isFree: true } })`) and `tx.subscription.create({ data: { userId: created.id, communityId: freeCommunity.id, payment: 0, paidOn: null, validUntil: <far future> } })`. `validUntil` is a required non-nullable column — no schema change to make it nullable, so "doesn't really expire" is encoded as a far-future date (e.g. 100 years out) with a comment saying why, rather than leaving the column's semantics ambiguous.
- If no free community exists yet (unseeded environment), don't fail registration over it — log a warning and skip the auto-subscribe step; the account is still created, just without free access until an admin seeds one. This is a real possibility in a fresh/test environment and shouldn't be a hard registration blocker.
- Scope check: this does **not** touch `addMember`/`importUsers`/`importUsersFromJSON` — those already assign a real subscription at creation time, so they don't need a free-tier top-up.

### §0.2 — CSV export has no label for a self-registered member's row

`membersToCsv`'s `STATUS_LABELS` map is keyed by the old 5-value `MemberStatus` enum. Once `registrationStatus` can be `null` (self-registered), there's no key for it. Resolved by deriving the CSV label the same way `deriveMemberStatus` used to, but from the new fields directly: `accountStatus==='suspended' → 'Suspended'`, `==='deleted' → 'Deleted'`, `registrationStatus==='pending' → 'Pending Sign'`, else `hasActiveSubscription ? 'Registered' : 'Expired'` — this last branch is now reachable by both admin-added *and* self-registered rows (`registrationStatus: null` falls through to it), and reads correctly for both: a self-registered member with only the free-tier subscription (§0.1) still shows `'Registered'` once that subscription exists, which is accurate.

### §0.3 — `search` would miss admin-added members who'd changed their own name/email, **and a live bug this exposed**

Root cause of the staleness isn't `search`'s query shape — it's that `ApprovedPhone.name/email` should already be kept in sync with self-service `User.name/email` edits, and mostly is: `auth.service.ts`'s `updateEmail`/`updateName` **already** write through to `ApprovedPhone` after updating `User` (`auth.service.ts:436-441`, `451-454`). Fixing the sync at the source (rather than widening `search` into an OR-across-two-tables query) is the right fix — once both tables genuinely stay in sync, `search` matching `User.*` alone (as §2 already plans) is correct by construction.

**But that existing sync code has a live bug**, found while confirming this: it calls `this.db.approvedPhone.update({ where: { phone }, ... })` — a plain `update`, which **throws** (Prisma P2025) if no `ApprovedPhone` row exists for that phone. For any self-registered user (no `ApprovedPhone`, by definition), calling `PATCH /auth/me/name` or `/auth/me/email` today: updates `User` successfully (that call isn't wrapped in a transaction with the one after it), *then* throws on the `approvedPhone.update` line, and the client receives an unhandled 500 for a write that actually already succeeded.

**Fix**: change both call sites from `.update(...)` to `.updateMany(...)` with the same `where`/`data` — `updateMany` never throws on zero matched rows (0-or-1 here, both are success), so it's a genuine no-op for a self-registered user instead of a crash, and still syncs correctly for an admin-added one. Do **not** use `upsert` here — creating an `ApprovedPhone` row just because someone edited their own display name would silently flip their `source` from `'self'` to `'admin'` (per §1's "Key architectural finding" below), which must only ever happen through the deliberate `updateMember`-with-`newCommunity` path, never as a side effect of a profile edit. Also wrap the `approvedPhone` sync call in its own try/catch, logged-not-rethrown — matches this codebase's existing convention for secondary/denormalized writes (e.g. every `notificationsQueue.add` call site here already does this) — so a transient failure syncing the display copy never fails the primary, already-successful `User` write.

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
      // Name, ascending — was createdAt desc. Deliberately User.name, not
      // ApprovedPhone.name: this is a DB-level ORDER BY over the driving
      // table, before the ApprovedPhone batch-fetch below even runs, so it
      // has to sort on a column that exists on every row regardless of
      // source. Self-registered members display ap?.name ?? u.name in the
      // DTO (unchanged precedence, see the note below), but since they have
      // no ap, u.name is what they sort by anyway — the only edge case is an
      // admin-added, already-registered member whose ApprovedPhone.name was
      // never synced to match a later User.name change (importUsers's
      // overwrite-strategy keeps them separate on purpose, see below): that
      // row's sort position uses User.name while its displayed name uses
      // ApprovedPhone.name. Accepted — sorting on the displayed name would
      // require sorting in application code instead of at the DB level,
      // which breaks pagination (LIMIT/OFFSET need the sort to happen in SQL).
      orderBy: { name: 'asc' },
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
  - `registrationStatus: 'pending'|'registered'` → fetch `ApprovedPhone.findMany({where:{status}})`, filter `phone: {in: matching}`. **Decided: literal-only** — self-registered members never match this filter (their `registrationStatus` is `null`); use `source` to find them instead. This makes the filter admin-added-only *by construction* — no additional `source` condition needs to be ANDed in.
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

**Fix**: change `reviveMember`'s `approvedPhone.update` to an `upsert` (details below), and stop unconditionally treating every revive as "back to square one."

Where `create`'s `name`/`email` come from, concretely — no extra lookup needed: `reviveMember(tx, existingUser, phone, name, email, adminId)` already receives `existingUser` and fresh `name`/`email` as its own parameters (`admin.service.ts:1603`), supplied by every call site *before* `reviveMember` ever runs — `reviveAndAddMember` already did `db.user.findUnique({where:{phone}})` to get `existingUser` and passes `data.name`/`data.email ?? null` from the admin's revive-confirmation form; `importUsers`/`importUsersFromJSON` pass the current CSV/JSON row's `name`/`email`. So "check `ApprovedPhone` by phone, and if that comes up empty, fall back to what's already known about the user" is exactly what happens — the `Users`-table half of that lookup already happened one level up, the `upsert`'s `create` branch just uses its result.

Why `upsert` specifically, not a manual "find, then create-or-update": a hand-written `const ap = await tx.approvedPhone.findUnique({where:{phone}}); if (ap) { ...update... } else { ...create... }` has a race window between the `findUnique` and the write — two concurrent revive attempts for the same phone could both see "not found" and both try to `create`, and the second one fails on the unique `phone` constraint anyway (this whole block already runs inside a `$transaction`, so it's not actually reachable in practice here, but it's the wrong pattern to reach for by default). `upsert` compiles to a single atomic `INSERT ... ON CONFLICT (phone) DO UPDATE` in Postgres — one round trip, no window where a concurrent write could interleave.

### Revive must not force a re-registration for someone who already registered

User's explicit correction (this changes the fix above, not just adds to it): today's `reviveMember` unconditionally does `passwordHash: null` on the `User` row and `status: 'pending'` on the `ApprovedPhone` — i.e. it always treats a revive as "this person needs to set up their account from scratch," which was harmless before this plan (only admin-added members, most of whom really were still pre-registration, could ever be suspended/deleted). It's wrong now: a self-registered member (or an admin-added member who'd already completed registration) already has their own working password — wiping it on revive would lock them out of credentials they still remember, for no reason. **Revive should branch on whether they were already registered before the suspension/deletion**, not treat every case identically:

- **Already registered** (`existingUser.passwordHash` is non-null going in): leave `passwordHash` untouched entirely — just drop that field from the `User` update, don't set it to anything. Set `ApprovedPhone.status: 'registered'` (both in `create` and `update`, since either could be the case for this branch). They log back in with the exact same phone/email + password they had before ("their old id[entity] and pass[word]", per the user's wording) — no new-account email, see below.
- **Never registered** (`existingUser.passwordHash` was already null): unchanged from the original fix — `ApprovedPhone.status: 'pending'`, `passwordHash` stays null (there was never anything to preserve or wipe).

```ts
private async reviveMember(
  tx: Prisma.TransactionClient,
  existingUser: { id: string; passwordHash: string | null },
  phone: string,
  name: string,
  email: string | null,
  adminId: string,
): Promise<{ userId: string; approvedPhoneId: string; wasAlreadyRegistered: boolean }> {
  const wasAlreadyRegistered = existingUser.passwordHash !== null

  await tx.user.update({
    where: { id: existingUser.id },
    // No passwordHash field at all — the old code's `passwordHash: null` here
    // is exactly the bug: it forcibly logged out/reset a member who already
    // had working credentials. Leaving the field out of the update object
    // means Prisma doesn't touch the column, whatever it currently holds.
    data: { name, email, status: 'active', suspensionReason: null },
  })

  const ap = await tx.approvedPhone.upsert({
    where: { phone },
    create: { phone, name, email, status: wasAlreadyRegistered ? 'registered' : 'pending', addedBy: adminId },
    update: { name, email, status: wasAlreadyRegistered ? 'registered' : 'pending', addedBy: adminId },
  })

  return { userId: existingUser.id, approvedPhoneId: ap.id, wasAlreadyRegistered }
}
```

`existingUser`'s type widens from `{ id: string }` to `{ id: string; passwordHash: string | null }` — every call site already fetches the full `User` row via `db.user.findUnique`, so this is free (no new query), just a wider type annotation.

**Email must match which branch fired** — this is the other half of the user's correction ("send email according to their status"). Today, both call sites (`reviveAndAddMember` at `admin.service.ts:1235`, and the equivalent blocks in `importUsers`/`importUsersFromJSON`) unconditionally enqueue `WELCOME_EMAIL_JOB` after a revive — the "set up your account" email, which is actively wrong/confusing for someone who isn't setting anything up because they're keeping their existing password. Branch on the new `wasAlreadyRegistered` return value instead:

```ts
const revived = await this.reviveMember(tx, existingUser, phone, data.name, data.email ?? null, adminId)
// ...create the subscription (unchanged)...

if (data.email) {
  if (revived.wasAlreadyRegistered) {
    // Same job revokeSuspension already uses for "you're back, log in as before"
    // — reuse it rather than inventing a near-duplicate template.
    await notificationsQueue.add(MEMBER_REINSTATED_EMAIL_JOB, { toEmail: data.email, name: data.name }, {...})
  } else {
    await notificationsQueue.add(WELCOME_EMAIL_JOB, { toEmail: data.email, name: data.name, phone, communityName: community.name, validTill: ... }, {...})
  }
}
```

Deliberately reusing `MEMBER_REINSTATED_EMAIL_JOB`/`sendMemberReinstatedEmail`/`member-reinstated.html` as-is (name-only payload — no community/validity mentioned), the exact same job `revokeSuspension` already fires for un-suspending someone. Accepted trade-off: unlike `WELCOME_EMAIL_JOB`, this revive path's reinstated-email doesn't mention which community they were just added to or the subscription's validity — reusing the existing template keeps this change small and consistent with the un-suspend case (which also doesn't add a subscription and doesn't mention one either); a member who wants those specifics sees them immediately on logging in. If that's judged insufficient later, it's a template/payload addition, not a logic change.

Apply the identical `wasAlreadyRegistered` branch to the two `importUsers`/`importUsersFromJSON` revive blocks (`admin.service.ts:~213` and `~352`) — same conditional, same two job choices, just sourced from the CSV/JSON row's `name`/`email` instead of `data.name`/`data.email`.

### Bulk-import revive-widening (in scope per user's decision)

`importUsers`/`importUsersFromJSON`'s revive-detection branches currently gate on `existingUser && existingAp` — a self-registered-then-suspended/deleted phone has no `existingAp`, so it falls through to the "brand new user" branch and hits `tx.user.create` on a phone that already exists → a Prisma unique-constraint error. Widen the condition to just `existingUser && existingUser.status !== 'active'` (drop the `existingAp` requirement), and apply the same `reviveMember` upsert fix so the branch works whether or not an `ApprovedPhone` already existed. Verify `importUsers`'s (CSV/XLSX path) per-row error handling actually catches this the same way `importUsersFromJSON` does — check there's a try/catch around this section in both, not just the JSON path.

## 5. Migration/rollout ordering

One Prisma migration is now needed (§0.1 added it): drop `Subscription.approvedPhoneId` (column, FK, index) and add `Community.isFree`, plus a data statement seeding one free `Community` row. DTO shape and route-parameter *meaning* change together and atomically — old frontend would break against new backend and vice versa — so land backend + frontend as **one coordinated PR** (same monorepo, deploy together anyway):

1. Migration first (schema change, no code depends on it existing yet but everything below depends on it being applied): drop `approvedPhoneId` from `Subscription`, add `Community.isFree`, seed the free community row.
2. Backend, in dependency order: `admin.dto.ts` → `admin.service.ts` (queries, 7 mutation functions, `reviveMember` fix + `approvedPhoneId` removal from every subscription-create call site listed in §0.1, `getCurrentSubscriptionIds` groupby swap — now mandatory, not optional, bulk-import widening) → `admin.controller.ts` (pass `req.user!.id` into `updateMember`, rename bulk-delete schema field) → `admin.routes.ts` (delete the `by-user/:userId` route) → `auth.service.ts` (§0.3's `updateMany` fix on `updateEmail`/`updateName`) → `mobile-auth.service.ts` (§0.1's free-community auto-subscribe in `finalizeRegistration`).
3. Frontend, same PR: `memberFormat.ts` (new shape + split label/style maps), `members/page.tsx` (filter UI, status rendering, bulk-delete payload key, stat-card query params), `members/[id]/page.tsx` (status rendering only — fetch/routing mechanics are already opaque-id-based, unchanged), `PostThreads.tsx` (drop the `by-user` lookup, direct `router.push`).
4. No data backfill needed for the userId-primary addressing change itself — only changes how existing rows are queried, not the rows themselves. The `Subscription.approvedPhoneId` column drop is a genuine, one-way schema change (no backfill needed either, since nothing reads the column after this ships) — but note it in the PR description as irreversible without a restore, standard for any column drop.
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
3. Revive a self-registered-then-suspended member (they have a real password) via `addMember` → confirm `MEMBER_REVIVE_REQUIRED` → `reviveAndAddMember` → succeeds (confirms the `reviveMember` upsert fix), **and**: their old password still logs them in unchanged, `registrationStatus` comes back `'registered'`, and they receive the reinstated email (not the welcome/set-up-your-account one).
3b. Revive an admin-added member who was suspended/deleted *before ever registering* (no password) → confirm they still get `registrationStatus: 'pending'` and the welcome email (unchanged from today) — i.e. confirm the branch actually branches, not just that the "already registered" case works.
4. Bulk-import (CSV and JSON paths) a row matching a self-registered-then-deleted phone with `reviveRowNums` including it — confirm it revives instead of erroring, and gets the same registered-vs-pending / reinstated-vs-welcome-email branching as #3/#3b.
5. An old bookmarked `/admin/members/{oldApprovedPhoneId}` URL 404s cleanly (expected, not a bug).
6. `PostThreads.tsx`'s "view member" link on a comment from a self-registered author now opens their profile instead of 404ing.
7. Filters: each of `accountStatus`, `registrationStatus`, `hasActiveSubscription`, `source` independently, and in combination with `communityId`/date filters, return the expected members.
8. CSV export (`GET /admin/members/export`) still produces a sensible "Status" column via the demoted `MemberStatus` label logic.
9. List (with a mix of admin-added and self-registered members present) comes back sorted by name, ascending — including across a page boundary (page 2's first name ≥ page 1's last name).
10. `registrationStatus=pending` and `registrationStatus=registered` each return admin-added members only — no self-registered member ever appears in either result, with or without an explicit `source` param alongside it.
11. `source=self` and `source=admin` partition the full unfiltered list with no overlap and no member missing from either.
12. **(§0.1)** Register a brand-new phone via mobile self-serve, verify OTP, then immediately log in (both web `/auth/login` and `POST /auth/mobile/login`) with no admin ever having touched the account — confirm success, not `SUBSCRIPTION_EXPIRED`. Confirm they show up with exactly one subscription (the free community) and `hasActiveSubscription: true`.
13. **(§0.1)** Confirm an admin-added member's normal `addMember` flow, `extendSubscription`, `updateMember`'s `newCommunity` path, and `importUsers`/`importUsersFromJSON` all still create working subscriptions post-migration (no `approvedPhoneId` field references left anywhere — a `grep -rn approvedPhoneId apps/backend/src` after implementation should only match DTO/route-param identity fields already covered by §1, never a `Subscription` write).
14. **(§0.1)** With no free community seeded (fresh/test DB), register a brand-new phone and confirm it still succeeds (no exception), just without an auto-granted subscription — and that a warning is logged, not swallowed silently.
15. **(§0.2)** CSV-export a self-registered member (with and without the free subscription active) — confirm the Status column shows `Registered`/`Expired` correctly rather than a blank or literal `undefined`.
16. **(§0.3)** As a self-registered user (no `ApprovedPhone`), call `PATCH /auth/me/name` and `/auth/me/email` — confirm `200`, not a `500`, and that the name/email change actually took effect (it already did before this fix, just returned an error). As an admin-added, already-registered member, do the same and confirm `ApprovedPhone.name/email` update too — then confirm they're still findable via `search` under their *new* name.

Run via `apps/backend`'s dev server + the admin frontend (`npm run dev` in both, or the existing `docker compose -f docker/docker-compose.production.yml` stack used earlier in this project) — no test suite exists to run instead.
