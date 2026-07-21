# Admin Dashboard

Admin's landing page after login: greeting, KPI stat tiles, community breakdown chart, expiring-soon
subscriptions list, recent posts list, and an unreplied-threads preview — plus an "Extend Subscription"
action modal. **Desktop-only** (no mobile/iPhone frame exists for this screen).

## Frame dimensions

- Primary frame ("MacBook Pro 14\" - 111", node `2553:92204`): **1512 × 994**
- Earlier iteration ("MacBook Pro 14\" - 110", node `2553:91948`): **1512 × 994** (same canvas size)
- Modal card (`2553:92599` / `Rectangle 3348` `2553:92601`): **499 × 352**, positioned at (516, 318)
  within the 1512×994 frame — roughly centered.

## Screenshots in this folder

| File | Source node | Notes |
|---|---|---|
| `desktop.png` | `2553:92204` | Full frame. **Important**: this frame bakes the "Extend Subscription" modal permanently into its canvas (see Annotations below) — the exported PNG shows the dashboard with a blurred backdrop and the modal already open, not a clean idle state. There is no separate "no modal" version of this exact frame. |
| `modal-extend-subscription.png` | `2553:92599` (Group containing the modal card) | Tight crop of just the modal card, isolated from the dashboard behind it, for cleaner reference. |
| `desktop-earlier-iteration.png` | `2553:91948` | Earlier/simpler design iteration of the same dashboard — see notes below. |

## Layout structure

**Primary frame (`-111`)**, left-to-right / top-to-bottom:

- **Sidebar** (`Background+Shadow`, `2553:92205`): 269×940 @ (21,22), corner radius 16, fill `#ffffff`,
  padding top 24 / right 16 / bottom 20 / left 16.
  - Avatar circle 65.32×65.32, fully rounded, fill `#108b8b`, initials "RK" white Bold 22.6px.
  - Name "Ritesh Kumar" Nunito Bold 16.3px, `#153d3a`.
  - "Super Admin" role pill: fully rounded, fill `#c1f26e`, padding ~3.8/15/3.8/15, text Nunito Bold 13.8px `#153d3a`.
  - Divider rule `#ede9e2`, 1px.
  - **Nav** (`2553:92222`), list of pill links, each 208×37 (up to 226×37 for longer labels), corner
    radius 999 (pill), padding 9/14: Dashboard (active — fill `#153d3a`, white text), Create Post,
    Members, Import CSV, Subscriptions, Unreplied Threads (badge "7"), Private Inbox, Stock Manager,
    Roles & Admins, Settings (badge "3"). Inactive link text `#7a8a80`, icon 13–15px.
    Notification badges: 27×16.28 pill, fill `#108b8b`, white Nunito Bold 10px number, padding ~0.5/11/0.8/7.
  - Logout row at bottom: icon + "Logout" text `#a0a89e`, Nunito SemiBold 13px.
  - Divider `#ede9e2` above logout.
- **Top bar**: breadcrumb-style small container (254×14.66), admin/profile icon buttons top-right
  (38×38 circular, one white with `#d6d2c8` border, one filled `#153d3a`), decorative teal/lime SVG
  vector doodle (60×60) at bottom-right of sidebar area.
- **Greeting header** (`2553:92311`): "Good Morning, Admin 👋" Nunito Bold 20px `#153d3a`; "Friday, 12
  June 2026" Nunito Regular 13px `#a0a89e` below.
- **Stat tile row** (`2553:92317`, 1136×164.66, 4 cards, each 269×164.66, gap 20px, x-offsets 0/289/578/867):
  corner radius 14, fill `#ffffff`, padding 20/20/16/20.
  1. Total Members **560** — icon circle `#108b8b`
  2. Active Subscriptions **498** — icon circle `#108b8b`, subtext "62 pending registration" `#a0a89e`
  3. Expiring This Week **14** — icon circle `#108b8b`
  4. Unreplied Threads **7** — icon circle `#dc2626` (red, urgent)
  Each: number Nunito Bold 32px (color matches icon accent), label Nunito Regular 11px `#153d3a`,
  "View all →" link Nunito SemiBold 11px (teal `#108b8b`, or red `#dc2626` on the Unreplied Threads tile).
- **Community Breakdown + Expiring Soon row** (`2553:92363`, 1136×252.66):
  - Community Breakdown card: 658.88×252.66, r14, padding 22. Title Poppins Medium 13px `#153d3a`.
    Horizontal stacked-bar-style breakdown: "Swing Alpha" 312 members 56% (pill tag fill `#e0f4f4`),
    "Investor Community" 248 members 44% (pill tag fill `#e0f4f4`), thin progress bars fill `#f5f3ed`
    track. Footer text "Total 560 whitelisted members" italic Nunito 11px.
  - Expiring Soon card: 457.13×252.66, r14, padding 22. Title Poppins Medium 13px + "Next 7 Days" tag
    (fill `#fff3e0`, text `#d97706`). Rows: name (Nunito Bold 13px), community tag (pill, `#c1f26e` for
    Swing Alpha / `#e0f4f4` for Investor, 9px Bold text), date (Nunito Bold 9px), "days left" tag (fill
    `#fff3e0`, text `#d97706`, 9-10px Bold), "Extend" action link `#108b8b`. 5 rows (Nikhil sen, Ram,
    Raghav sen, Dev Singh, Jai Sharma). Footer "View all subscriptions →".
- **Recent Posts + Unreplied Threads preview row** (`2553:92468`, 1136×336.3):
  - Recent Posts card: 613.44×336.3, r14, padding 22. Header "Recent Posts" + "Create New +" pill button
    (fill `#c1f26e`, r999). 4 post rows with title, community tag, timestamp.
  - Unreplied Threads preview card: 502.56×336.3, r14, padding 22. Header "Unreplied Threads" + "7
    pending" tag (fill `#fdecea`, text-ish red). 4 rows: name, community tag, "Reply →" action,
    italicized quoted message preview (Nunito Italic 11px), relative time ("18 hrs ago" etc).
- **"Extend Subscription" modal** (overlay, baked into the same frame — see Annotations):
  - Backdrop: `Rectangle 3349` (`2553:92598`), 1512×993, fill `#d9d9d933` (~20% opacity gray) covering
    the full canvas. The exported screenshot additionally shows a strong blur applied to everything
    behind the modal (frosted-glass look) — no `effects`/blur-radius data was returned by the Figma
    MCP tool for this node, so the exact blur radius is not capturable as a raw value; treat it as a
    heavy (~10–16px) background blur applied behind the modal layer.
  - Modal card: `Rectangle 3348` (`2553:92601`), 499×352 @ (516,318), corner radius **20**, fill `#ffffff`.
  - Header: icon badge 34×34, corner radius 10, fill `#108b8b` (crown icon, white); heading "Extend
    Subscription" — font **Inter Semi Bold 22px**, color **`#000000`** (raw black — flag: inconsistent
    with the rest of the file, which uses `#153d3a` for headings; likely the same "Inter leaking in"
    issue called out in `design-tokens.md`). Close "×" icon top-right. Divider rule below header.
  - Field "Current Date" (label Nunito SemiBold 13px `#153d3a`) — read-only input showing "12 Jun 2026",
    box 452×43, r10, fill `#ffffff`, stroke `#d6d2c8`, padding 11/14.
  - Field "Extend Date" (same label style) — input "Select Date" placeholder `#b0aba1` Nunito Regular
    13px, calendar icon, same box styling as above.
  - Buttons: "Cancel" — 222×43, pill (r50), fill `#ffffff`, stroke `#e5e0d8`, text Poppins Medium 14px
    `#153d3a`. "Extend Subscription" — 222×43, pill (r50), **fillStyle "Gredient 2"** (the shared
    lime→teal gradient, confirmed via node style), text Poppins Medium 14px `#ffffff`.

## Colors used on this screen (raw hex)

Baseline palette already in `design-tokens.md`: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`,
`#d6d2c8`, `#b0aba1`, `#a0a89e`, `#ede9e2`. Gradient "Gredient 2" used on the primary modal CTA button.

**New / admin-specific colors not in the shared token set — flagged:**

| Hex | Usage |
|---|---|
| `#7a8a80` | Muted sidebar nav icon/text (inactive state) — already listed as a variant in design-tokens.md |
| `#e0f4f4` | Light teal pill background — "Swing Alpha" community tags |
| `#fff3e0` | Light amber pill background — "Investor Community" tag / "days left" expiry tags |
| `#d97706` | Amber/orange text — expiry countdown text, "Next 7 Days" tag text |
| `#dc2626` | Red — Unreplied Threads stat icon/number/link, urgent indicators |
| `#fdecea` | Light red/pink pill background — "7 pending" badge on Unreplied Threads preview card |
| `#f0ede8` | Divider/border stroke on list rows (`HorizontalBorder`) — close to but distinct from `#ede9e2` |
| `#e5e0d8` | Button border stroke on pill "Cancel"/secondary buttons — close to but distinct from `#d6d2c8` |
| `#292d32` | Near-black icon fill on some vuesax/solar icon sets — likely icon-library default color, not an intentional palette color |
| `#d9d9d933` | Modal backdrop dimmer (semi-transparent gray, ~20% alpha) |
| `#000000` | Raw black on modal heading text ("Extend Subscription") — flagged as inconsistent, see above |
| `#e9ca83` / `#3a2002` | One-off decorative icon stroke colors, negligible/likely icon-asset artifacts |

## Typography

| Role | Family | Weight | Size | Line-height |
|---|---|---|---|---|
| Greeting heading | Nunito | Bold | 20px | 30px |
| Stat tile number | Nunito | Bold | 32px | 35.2px |
| Stat tile label | Nunito | Regular | 11px | 14.67px |
| "View all →" links | Nunito | SemiBold | 11px | 14.67px |
| Sidebar nav item (Poppins variant) | Poppins | Regular | 13px | 18.57px |
| Sidebar nav item (Nunito variant — Dashboard/Members/Logout/Settings) | Nunito | SemiBold | 13px | 18.57px |
| Card section titles (Community Breakdown, Expiring Soon) | Poppins | Medium | 13px | 18.57px |
| Person names in list rows | Nunito | Bold | 13px | 18.57px |
| Community/date tag text | Nunito | Bold | 9–10px | 13.5–15px |
| Quoted reply preview (italic) | Nunito | Italic | 11px | 14.67px |
| User name (sidebar profile) | Nunito | Bold | 16.33px | 23.33px |
| "Super Admin" role badge | Nunito | Bold | 13.82px | 18.43px |
| Avatar initials | Nunito | Bold | 22.61px | 35.17px |
| Modal field label | Nunito | SemiBold | 13px | 18.57px |
| Modal input placeholder/value | Nunito | Regular | 13px | 18.57px |
| Modal button text | Poppins | Medium | 14px | (auto) |
| **Modal heading (flagged: font/color mismatch)** | **Inter** | **Semi Bold** | **22px** | (auto) |

## Component measurements

- **Stat tile card**: 269×164.66, corner radius 14, padding 20/20/16/20, icon circle 36×36 fully rounded.
- **Sidebar card**: 269×940, corner radius 16, padding 24/16/16/20.
- **Content card** (Community Breakdown / Expiring Soon / Recent Posts / Unreplied preview): corner
  radius 14, padding 22 all sides.
- **Sidebar nav pill link**: 208×37 (226×37 for longer labels), corner radius 999 (pill), padding 9/14.
- **Notification count badge**: ~27×16.28, corner radius 999, padding ~0.5/11/0.8/7.
- **Status/community tag pill**: height 18–19px, corner radius 999, padding 2/9.
- **Avatar / icon circle**: 36×36 or 65.32×65.32, corner radius 999 (fully rounded).
- **Modal**: 499×352, corner radius 20, centered overlay; icon badge 34×34 r10; input fields 452×43 r10
  padding 11/14 stroke `#d6d2c8`; buttons 222×43 pill (r50).

## Figma node IDs used

- Primary dashboard frame: `2553:92204`
- Earlier iteration frame: `2553:91948`
- Modal group (screenshot crop source): `2553:92599`
- Modal backdrop: `2553:92598`; modal card background: `2553:92601`; modal heading: `2553:92608`;
  icon badge: `2553:92609`; Current Date field: `2553:92622`; Extend Date field: `2553:92625`;
  Cancel button: `2553:92630`; Extend Subscription button: `2553:92632`/`2553:92633`

## Annotations / notes

- **Earlier iteration**: `2553:91948` ("MacBook Pro 14\" - 110") is a simpler/earlier version of this
  same dashboard — same 4 stat tiles + Community Breakdown + Expiring Soon, but it's **missing** the
  Recent Posts and Unreplied Threads preview panels present in `-111`, and its greeting reads "Good
  Morning, Ritesh 👋" (a named user) instead of "Good Morning, Admin 👋". Its sidebar also lists nav
  items slightly differently (separate "Feed"/"All Posts"/"Stock Recommendation" entries with counts
  "9"). Treat `-111` as the superseding/current design and `-110` as a superseded draft, kept here only
  for reference.
- **Modal baked into frame**: the "Extend Subscription" modal (`2553:92599`) is a permanent child of
  the same frame as the dashboard content — Figma frames don't support toggleable visibility states, so
  the modal and its blurred backdrop are always present when the full frame `2553:92204` is rendered.
  This is why `desktop.png` shows the modal open rather than an idle dashboard state.
- **Stray duplicate nearby**: node `2555:116963` ("-118"), spatially located in this Admin Dashboard
  cluster, is a stray duplicate of the already-exported `.figma-export/profile-settings/` screen (User
  Dashboard content, misplaced here). It was not re-exported — flagging here so the knowledge isn't lost.
- **Backend cross-reference**: stat tile figures (Total Members, Active Subscriptions, Expiring This
  Week, Unreplied Threads) correspond to admin summary/stat endpoints; "Unreplied Threads" preview maps
  directly to `/api/v1/admin/pending-post-threads` (see `unreplied-threads/styling.md` for the full
  dedicated screen and its close match to the already-implemented
  `apps/frontend/src/app/admin/unresolved-threads/page.tsx`).
