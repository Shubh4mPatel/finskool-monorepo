# Unreplied Threads

Admin inbox of member comments still awaiting a reply, grouped by the post they were left on, with an
expand/collapse-per-post interaction and an inline reply composer. **Desktop-only** — no mobile frame
exists for this screen.

## Screenshots in this folder

| File | Source node | State |
|---|---|---|
| `desktop.png` | `2553:94081` ("-114") | Working state — 7 pending, one post's threads expanded (Jai Sen / Raj Verma / Riya Sharma) |
| `empty-state.png` | `2553:92634` ("-112") | "All caught up!" zero-pending state |

## Frame dimensions

- `desktop.png`: **1512 × 1838** (very tall — an expanded thread group pushes the page height well past
  the standard 994/994 admin canvas)
- `empty-state.png`: **1512 × 1121**
- Toolbar card: 860×65 @ (0,94.66) inside a 860-wide content column
- Collapsed thread-group card: 860×258 (varies with body length)
- Expanded thread-group card: 860×694 (contains 3 reply rows + inline composer)
- Empty-state card: content padding 67.99/32/48/32, icon 72×72

## Layout structure

- Sidebar: standard spec; "Unreplied Threads" nav item active, badge "7".
- Header: "Unreplied Threads" (Poppins SemiBold 22px `#153d3a`) + "Member comments waiting for your
  response. Oldest first." subtitle (Nunito Regular 13px) + "7 pending" badge (pill, fill `#fdecea`,
  text `#dc2626`, Nunito Bold 14px).
- Toolbar (`Background+Shadow`, 860×65, r12, padding 14/18): filter pills "All" (active — fill
  `#153d3a`, white text), "Swing Alpha" / "Investor Community" (white bg, stroke `#153d3a`) — all pill
  r999; "Oldest First" sort dropdown (`Background+Border`, r10, white bg, stroke `#153d3a`); "Mark All
  Replied" pill button (white bg, stroke `#153d3a`, check icon, Nunito SemiBold 13px).
- Search bar (top right, reused component): pill, stroke `#108b8b`, placeholder color `#108b8bb2` —
  identical to the search bar seen in `all-posts`.
- **Collapsed thread-group card** (per post with unreplied comments): post title (Nunito Bold 20px
  `#153d3a`), truncated body preview (Nunito Regular 14.5px, lh 26.1, color `#4a5a50`), "View Threads
  (N)" link (teal `#108b8b`), a small 3-dot menu affordance, all inside a card with a **teal left/top
  accent border** (`Background+VerticalBorder`, stroke `#108b8b`).
- **Expanded thread-group card** (`Background+HorizontalBorder`, 860×694, fill `#fafbfe` — a distinct
  near-white blue-tinted background not used elsewhere, stroke `#108b8b`):
  - Post title + full body + hashtag chips (`#TATASTEEL` `#BUY` `#SWING` `#NSE` — pill, r6, white bg,
    Nunito SemiBold 13px `#153d3a`).
  - "Mark Replied" pill link near the top (stroke `#108b8b`, text color **`#5c8683`** — a new muted
    teal, flagged).
  - 3 reply rows, each: avatar-initials circle (fill `#e8f5ec` — new pale mint, flagged), name (Poppins
    Medium 13px `#153d3a` — "Jai Sen" / "Raj Verma" / "Riya Sharma"), timestamp, quoted trade-context
    line ("Entered at ₹164.5. SL placed. Will hold for the target.") rendered against a green vertical
    accent bar (`Vector 33`/`Vector 4`, stroke `#85cd78`), "Reply" action link (Nunito SemiBold ~10.4px).
  - One row is expanded into an **inline reply composer**: a highlighted row with light-green background
    (`Background+VerticalBorder`, fill `#f5f3ed`, stroke `#85cd78`) showing an "ADMIN" badge (pill, fill
    `#c1f26e`, Nunito Bold ~9.4px), then below it a text input box ("Type your reply here…", placeholder
    color `#c0c8c0`, box `Background+Border` r10 stroke `#108b8b`) — this is the **"Post Reply" input**
    called out in the task brief.
  - Delete/trash icon buttons (`vuesax/linear/trash`) appear per reply row.
- Second post group further down ("Threads (12)" heading, `#153d3a`/count in `#108b8b`) shows the same
  collapsed-card pattern is reused per post.

## Colors used on this screen (raw hex)

Baseline palette applies (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#a0a89e`, `#ede9e2`).

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#4a5a50` | Post body preview/snippet text |
| `#5c8683` | "Mark Replied" link text color |
| `#e8f5ec` | Reply-row avatar circle background (pale mint) |
| `#85cd78` | Green vertical accent bar next to quoted trade context, and the highlighted reply-composer row border — this color **is** already in the shared `design-tokens.md` palette (green accent), reused here consistently |
| `#fafbfe` | Expanded thread-group card background — a distinct pale blue-white |
| `#fdecea` | "7 pending" badge background (matches `dc2626`-family error/urgent color already flagged elsewhere) |
| `#f3f3f3` | Thin divider rule between reply rows |
| `#c0c8c0` | Reply-input placeholder text (same gray flagged in `create-post`/`import-csv`) |
| `#108b8bb2` | Search placeholder text (same as `all-posts`) |
| `#dc26261a` | Delete/reject icon-button background tint on collapsed-card row actions |
| `#c1f26e1a` | Community tag pill background |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading | Poppins | SemiBold | 22px |
| Pending-count badge | Nunito | Bold | 14px |
| Filter pill / Mark All Replied | Nunito | SemiBold | 13px |
| Post title (thread-group) | Nunito | Bold | 20px |
| Post body preview | Nunito | Regular | 14.5px (lh 26.1) |
| Post body full (expanded) | Nunito | Regular | 12.24–14px |
| "View Threads (N)" link | mixed run | ~13px |
| Reply author name | Poppins | Medium | 12.24–13px |
| Reply quoted context | Nunito | Regular | 14px (lh 20.19) |
| "Reply" action link | Nunito | SemiBold | ~10.36px |
| "Mark Replied" link | Nunito | SemiBold | 11px |
| Avatar initials | Nunito | Bold | ~11.3px |
| "ADMIN" badge | Nunito | Bold | ~9.41px |
| Reply input placeholder | Nunito | Regular | ~13px |
| Empty-state heading | Nunito | Bold | 18px |
| Empty-state body | Nunito | Regular | 13px (lh 22.1) |

## Component measurements

- **Toolbar card**: 860×65, r12, padding 14/18.
- **Filter pill**: ~35px tall, r999, padding 7/14.
- **Collapsed thread-group card**: 860×258, r-mixed (rounded top corners), stroke `#108b8b` (1px),
  padding 18/20/16/20.
- **Expanded thread-group card**: 860×694, fill `#fafbfe`, stroke `#108b8b`, padding 18/22/18/22.
- **Reply row**: avatar 33.89×33.89 (fully rounded), quote accent bar ~21×85 rounded (r≈10).
- **Reply composer input**: 743×102, r10, stroke `#108b8b`, padding ~13.5/14/65.5/14 (tall enough for
  multi-line text).
- **Empty-state icon**: 72×72 circle, `#c1f26e` border stroke.

## Figma node IDs used

- Main working state: `2553:94081`
- Empty state: `2553:92634`

## Annotations / notes (verbatim designer notes, Hindi)

Two Hindi-language sticky-note annotations sit just outside the frame's right edge (canvas position
~x=12865–12903, i.e. immediately adjacent to frame `-114`), explaining the interaction model:

1. **`2563:2246`**: *"iss par click karne par, thread open hoga and if already opened hai toh is pat
   click karne par close hoga"* — translation: clicking this opens the thread; clicking it again closes
   it if it's already open. (Describes the expand/collapse toggle on "View Threads (N)".)
2. **`2563:2389`**: *"Mark read karne se yeh hat jayega yaha se , kyuniki yaha hum sirf unreplied wala
   reply bata rahe hai"* — translation: marking as read removes it from this list, since this view only
   shows unreplied comments. (Explains why "Mark Replied" causes a row/thread to disappear from this screen.)

- **Duplicate iteration**: node `2563:2656` ("-119") is a near-duplicate/earlier iteration of this same
  screen (same content pattern as `-114`) — not exported separately, since it doesn't add new
  information beyond what's captured here.
- **Backend cross-reference**: this screen maps directly to the already-implemented
  `/api/v1/admin/pending-post-threads` and `/api/v1/admin/comment-notifications/*` endpoints, and the
  existing `apps/frontend/src/app/admin/unresolved-threads/page.tsx` page is already a very close match
  to this design (grouped-by-post unreplied comments, expand/reply/mark-replied actions). The confirm
  dialogs used on that page should reference `confirm-dialog-component/styling.md` for the shared visual
  spec.
