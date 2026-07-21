# All Posts

Admin's list of all posts published across every community: filters, search, and a feed of post cards
(some with an attached image). **Desktop-only** — no mobile frame exists for this screen.

## Screenshots in this folder

| File | Source node |
|---|---|
| `desktop.png` | `2553:91292` ("-107") |

## Frame dimensions

1512 × 994 (same admin canvas size as the other admin screens).

- Filter/search bar row: y≈43–94
- Regular post card: 524×236, r16
- Image post card: 524×468, r16

## Layout structure

- Sidebar: standard 269×940 spec (see `admin-dashboard/styling.md`); "All Posts" nav item active
  (badge "9").
- Header: "All Post" heading (Nunito Bold 22px `#153d3a`) + small teal eyebrow label "All Post" (Nunito
  ExtraBold 11px `#108b8b`) — the subtitle text underneath is literally "Follow the steps to publish a
  post to your community" (Nunito Regular 13px `#153d3a`), copy-pasted verbatim from the `create-post`
  wizard header — flagged as a content mismatch (see Annotations).
- Filter row (top right, `Frame 2121453386`, 427×41): "All Community" dropdown (150×41, r999, white bg,
  stroke `#153d3a`) + "Date" dropdown (113×41, same style) + "Create Post" pill button (140×41, r999).
- Search bar (`2563:2366`, 304×42, r999, white bg, stroke `#108b8b`): placeholder "Search with Title and
  hashtags....." in `#108b8bb2` (teal at ~70% opacity — a new alpha-variant color, flagged) + search icon.
- **Post card** (regular, no image — 524×236, r16, white bg, **stroke `#c1f26e`** — every post card in
  this list has a lime-green border unconditionally, not just on hover/selected state):
  - Avatar circle (38×38) + author name "Ritesh Kumar" (Nunito Bold 16.3px).
  - Community tag pill: "Swing Alpha" (fill `#c1f26e1a`, stroke `#c1f26e`) or "Investor" (fill
    `#108b8b1a`, stroke `#108b8b`).
  - Timestamp "9:15 AM" + date "11 Jun 2026" (Nunito Regular 11px `#a0a89e`).
  - Title, e.g. "HDFCBANK — Accumulate on Dips Near ₹1,620" (Poppins SemiBold 15px, lh 20.25, `#153d3a`).
  - Body copy (Nunito Regular 13px, lh 21.45, color **`#5a6a60`** — new muted teal-gray, not in the
    shared palette).
  - Hashtag chips (`#HDFCBANK`, `#ACCUMULATE`): small pill (Background+Border, r6, white bg, ~22.66px
    tall, Nunito SemiBold 11px).
- **Post card with image** (524×468, r16, `Background+HorizontalBorder+Shadow`, stroke `#c1f26e`): same
  header/title/body/hashtag structure as above, plus a 480×240 image block (r10) between body text and
  hashtags. Title style here is slightly bolder: Poppins SemiBold 16px (vs 15px on the no-image card).

## Colors used on this screen (raw hex)

Baseline palette from `design-tokens.md` applies (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`,
`#ede9e2`, `#a0a89e`).

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#5a6a60` | Post body copy text — a muted teal-gray not seen on other admin screens |
| `#108b8bb2` | Search input placeholder text — `#108b8b` at ~70% alpha |
| `#c1f26e1a` / `#108b8b1a` | Community tag pill backgrounds (Swing Alpha / Investor respectively) — consistent with other admin screens' community tags |
| `#292d32` | Icon-library default dark fill (same recurring flag as other screens) |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading | Nunito | Bold | 22px |
| Eyebrow label | Nunito | ExtraBold | 11px |
| Filter dropdown text | Nunito | Bold | 13px |
| Search placeholder | Nunito | SemiBold | 13px |
| Post author name | Nunito | Bold | 16.33px |
| Post community tag | Nunito | SemiBold | 11px |
| Post timestamp/date | Nunito | Regular | 11px |
| Post title (no-image card) | Poppins | SemiBold | 15px |
| Post title (image card) | Poppins | SemiBold | 16px |
| Post body copy | Nunito | Regular | 13px (lh 21.45) |
| Hashtag chip | Nunito | SemiBold | 11px |

## Component measurements

- **Filter dropdown**: 41px tall, r999 (pill), white bg, stroke `#153d3a`, padding 10/18.
- **Search bar**: 42px tall, r999 (pill), stroke `#108b8b`, padding 7/16.
- **Post card**: r16, stroke `#c1f26e` (1px, always visible), padding ~20/22/18/22.
- **Hashtag chip**: ~22.66px tall, r6, padding 2/10/3.66/10.
- **Image block** (image post variant): 480×240, r10.

## Figma node IDs used

- Frame: `2553:91292`

## Annotations / notes

- **Content mismatch**: the subtitle under the "All Post" heading reads "Follow the steps to publish a
  post to your community" — this is the `create-post` wizard's subtitle, reused here verbatim. It
  doesn't make sense on a list/browse page (there are no "steps" here). Likely a copy-paste artifact
  from duplicating the `create-post` frame as a starting point for this screen.
- **Admin's Live Feed**: this repo's admin section also has a plain Live Feed view for admins (Figma
  node `2569:6698`, named "Working") which is the same Live Feed component already fully documented in
  `.figma-export/live-feed/styling.md` from the User Dashboard pass — not re-documented here.
- **Backend cross-reference**: maps to `GET /api/v1/posts` with an admin role/scope in
  `posts.controller.ts` — filters correspond to community/date query params, and "Create Post" launches
  the `create-post` wizard documented separately.
