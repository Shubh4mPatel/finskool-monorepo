# Live Feed — Thread Expanded (Comment Thread View)

Same live feed layout as `live-feed/`, but with one post's comment thread expanded below the post card:
member replies, an admin reply (visually distinguished), a "Reply" action per comment, and an
"Add to the discussion…" composer with a "Post Reply" button.

**Behavioral note (from Figma annotation on this screen):** *"user can delete his comment, but once
admin replies user can not delete his comment."* In the raw layer data, a trash/delete icon
(`vuesax/linear/trash`) appears attached to several comment rows (including the current user's own "You"
comment and other members' comments) — this is likely just how the Figma component template includes the
icon on all rows, with the actual conditional show/hide (delete allowed only until an admin reply exists)
implemented in application logic rather than shown as distinct Figma variants. Implement the delete-button
visibility rule from the annotation text, not from which rows happen to show the icon in this file.

## Frame dimensions

- Desktop: **1512 x 1549** px ("MacBook Pro 14\" - 58")
- Mobile: **402 x 1902** px ("iPhone 16 & 17 Pro - 7")

## Layout structure

Shared chrome (left nav sidebar on desktop, top search/filter bar, right Market Today + Community Rules
widgets on desktop, bottom tab bar on mobile) is **identical** to `live-feed/` — see that screen's
styling.md for full detail on the sidebar, search bar, filter pills, and widget cards. This document only
covers what's different: the post card + its expanded comment thread.

### Desktop (1512x1549)
- **Post card** (`2541:4802`/`2541:4803`, "Background+HorizontalBorder+Shadow"): same TATASTEEL breakout
  post as in `live-feed/`, cornerRadius "mixed" (top corners rounded ~16px, bottom corners squared off
  where the card visually merges into the thread panel below it), fill `#ffffff`, border `#c1f26e`.
- **Thread panel background** (`2541:4237`, "Rectangle 3344"): a large rectangle behind the whole comment
  section, `w:555 h:740`, fill `#fafbfe` (a very light blue-white — a new screen-specific token, distinct
  from the page's `#f5f3ed`).
- **"Threads (12)" header** (`2541:4256`): "Threads" Nunito Bold **16px** `#153d3a` + "(12)" Nunito
  SemiBold **12.24px** `#108b8b`, divider below in `#e2e8e4` (another new near-`#ede9e2` token).
- **Comment list** (`2541:4262`), each comment row:
  - Circular avatar with initials (~34x34px, cornerRadius fully rounded), background/text color varies
    per member: M1 = bg `#e8f5ec` / text `#153d3a`; M2 = bg `#e0f4f4` / text `#108b8b`; M3 = bg `#e8eeec`
    / text `#2d5e5a` (each a distinct member-color pairing — treat as an avatar color palette, not a
    single token).
  - Name row: author name ("You" / "Member #2" / "Ritesh Kumar") Nunito Bold **13px** (desktop) `#153d3a`
    (or Poppins Medium 12.24px for "You" specifically — verify), timestamp (date + clock icon + time)
    Nunito Regular 11px `#7a8a80`.
  - Comment body: Nunito Regular **~12.24px**, line-height ~20.2px, color `#4a5a50` (a new muted-green
    token, distinct from the post-body `#5a6a60` used elsewhere).
  - "Reply" action: Nunito SemiBold **~10.36px**, color `#108b8b`.
  - Regular (non-admin) comments have **no background box** — just avatar + text inline on the panel background.
  - **Admin reply** (`2541:4293`/`2541:4918`, "Background+VerticalBorder"): distinct treatment — fill
    `#f5f3ed`, cornerRadius "mixed" (soft rounded box), border/accent `#85cd78`, padding ~13.2px. Includes
    an "ADMIN" pill badge (fill `#c1f26e`, text Nunito Bold **9.41px** `#153d3a`) next to the author name.
    A tall rounded vertical accent bar (`Vector 3`/`Vector 4`, stroke `#85cd78`, cornerRadius ~9.97px)
    connects/threads consecutive admin-adjacent replies visually on the left edge.
- **Composer** (`2541:4239`, "Background+Shadow"): `w:497 h:149`, cornerRadius **11.35px**, fill
  `#ffffff`, padding ~18.9/20.8/17.0px. Contains:
  - Empty circular avatar placeholder (34x34, fill `#f0f2f0`, border `#c8d0cc` — both new tokens).
  - Text input area ("Border" frame): cornerRadius **9.46px**, border `#108b8b`, placeholder
    "Add to the discussion…" Nunito Regular **12.3px**, color `#b0aba1`.
  - "Post Reply" button: cornerRadius fully rounded (raw ~944.89), label Nunito Bold **12.3px** `#ffffff`
    + arrow-right icon. Fill/background color wasn't returned by this node read (same caveat as other
    primary CTAs in this file) — verify against the screenshot before assuming it's the "Gredient 2"
    gradient vs. a solid dark fill.
  - Lock icon + "Your identity is kept private from other members": Nunito Regular **10.4px**, `#b0aba1`.

### Mobile (402x1902)
Same structure, stacked and scaled down:
- Post card cornerRadius `~26.17px`, border `#b6e54d` (same mobile-only lime variant flagged in
  `live-feed/`), post heading/body in **Inter** (same font mismatch flagged in `live-feed/`).
- "Threads (12)" header: "Threads" Nunito Bold 16px `#153d3a`, "(12)" Nunito SemiBold 12.24px `#108b8b`.
- Comment rows: avatar ~31.3px, same per-member color pairs (M1/M2/M3), author name in **Poppins Medium
  ~11.29px** for member labels (vs. Nunito Bold on desktop for some rows — inconsistent across rows even
  within this one screen; verify per-row against the screenshot), comment body Nunito Regular ~11.29px
  `#4a5a50`, "Reply" Nunito SemiBold ~9.55px `#108b8b`.
- Admin reply: same `#f5f3ed` box + `#85cd78` accent bar + "ADMIN" pill, scaled down (badge text ~8.68px).
- Composer: cornerRadius **6.44px** (much tighter radius than desktop's 11.35px), border `#108b8b`,
  placeholder Nunito Regular ~8.38px `#b0aba1`. "Post Reply" button cornerRadius fully rounded (~571.33),
  label Nunito Bold **10px** `#ffffff`.
- Bottom tab bar: same four tabs as `live-feed/`, but the third tab's label here reads **"Recommendation"**
  (singular) vs. **"Picks"** on the plain `live-feed/` mobile screen — an inconsistency between the two
  screens; confirm the intended label with the design owner before implementing.

## Colors used on this screen

Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#85cd78`, `#f5f3ed`, `#ffffff`, `#7a8a80`, `#b0aba1`.

Screen-specific (new vs. shared palette):
- `#fafbfe` — thread panel background rectangle.
- `#e2e8e4` — "Threads" header divider (near-duplicate of shared `#ede9e2`).
- `#4a5a50` — comment body text color (distinct from post-body `#5a6a60`).
- `#e8f5ec` / `#153d3a` — member avatar M1 (bg/text).
- `#e0f4f4` / `#108b8b` — member avatar M2 (bg/text).
- `#e8eeec` / `#2d5e5a` — member avatar M3 (bg/text).
- `#f0f2f0` / `#c8d0cc` — composer's empty avatar placeholder (bg/border).

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Color |
|---|---|---|---|---|
| "Threads" header | Nunito | Bold | 16px | `#153d3a` |
| "(12)" count | Nunito | SemiBold | 12.24px | `#108b8b` |
| Comment author | Nunito (or Poppins Medium for some rows) | Bold / Medium | 13px / 11.29px | `#153d3a` |
| Comment timestamp | Nunito | Regular | 11px / 10.14px | `#7a8a80` |
| Comment body | Nunito | Regular | 12.24px / 11.29px | `#4a5a50` |
| "Reply" action | Nunito | SemiBold | 10.36px / 9.55px | `#108b8b` |
| "ADMIN" badge | Nunito | Bold | 9.41px / 8.68px | `#153d3a` on `#c1f26e` |
| Composer placeholder | Nunito | Regular | 12.3px / 8.38px | `#b0aba1` |
| "Post Reply" label | Nunito | Bold | 12.3px / 10px | `#ffffff` |
| Privacy note | Nunito | Regular | 10.4px | `#b0aba1` |

## Component measurements

- **Thread panel background**: fill `#fafbfe`, no visible corner radius constraint (full-bleed rectangle behind the list).
- **Admin reply box**: cornerRadius "mixed" (soft-rounded), fill `#f5f3ed`, border-left accent `#85cd78` (~9.2-10px rounded bar), padding ~12-13px.
- **Composer card**: cornerRadius 11.35px (desktop), fill `#ffffff`, padding ~17-19px/21px.
- **Composer input**: cornerRadius 9.46px (desktop) / 6.44px (mobile), border 1px `#108b8b`.
- **"Post Reply" button**: fully rounded pill, padding ~9.5/20.8px (desktop), ~5.7/12.6px (mobile).
- **Avatar circles** (comments): ~34px (desktop) / ~31.3px (mobile), fully rounded.

## Figma node IDs

- Desktop top-level frame: `2541:4578` ("MacBook Pro 14\" - 58")
- Mobile top-level frame: `2650:6317` ("iPhone 16 & 17 Pro - 7")

## Notes

- All shared-chrome details (sidebar nav, search bar, Market Today / Community Rules widgets, bottom tab
  bar structure) match `live-feed/styling.md` — refer there rather than duplicating.
- The "Post Reply" button's fill/background wasn't returned by `get_node` for this specific layer (same
  gap seen on other primary CTAs in this file) — check the screenshot before hardcoding a solid vs.
  gradient fill.
- The bottom mobile tab's third label ("Recommendation" here vs. "Picks" in `live-feed/`) is inconsistent
  between the two screen variants — flag for product/design clarification.
