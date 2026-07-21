# Announcements — Notification / Announcement Center

Notification center screen with "Recent" and "Previous" sections listing system/community announcements
(e.g. "X shared a new market insight", "X has Replied to your thread", financial-result alerts), each with
a relative timestamp and a "View" CTA.

## Frame dimensions

- Desktop: **1512 x 933** px ("MacBook Pro 14\" - 74")
- Mobile: **402 x 1105** px ("iPhone 16 & 17 Pro - 15")

## Layout structure

### Desktop (1512x933)
- **Left nav sidebar**: identical to `live-feed/` (Background+Shadow, cornerRadius 16px, Feed/Announcements
  (active here)/Recommendations/My Threads/Logout). "Announcements" is the active item in this screen
  (dark `#153d3a` pill, white label/icon).
- **Top bar**: "Announcement" heading (Poppins SemiBold **20px**, `#153d3a`) + "Refresh" button (pill,
  fill `#153d3a`, border `#ffffff`, rotate icon + label Nunito SemiBold 13px `#ffffff`, cornerRadius fully
  rounded) + "Swing Alpha" community chip (bordered pill, fill `#c1f26e1a`, border `#c1f26e`) + avatar/name.
- **"Recent" section** (`x:328 y:101`): heading "Recent" Poppins SemiBold **18px** `#153d3a` + a small red
  unread-indicator dot (`#dc2626` — a new, more saturated red than the shared `#e05050`; treat as its own
  "unread badge" token, verify against screenshot for exact use).
  - 3 announcement cards stacked (`Rectangle 42095/42096/42097`, `w:1141 h:87`), each: fill `#ffffff`,
    cornerRadius **20px**, no border/shadow data returned (verify against screenshot for shadow).
    - Leading icon: 56x56 circle. Two treatments seen: (a) plain empty circle (likely a user-avatar
      placeholder) for "shared a new market insight" / "has Replied to your thread" rows, and (b) a solid
      `#153d3a` circle with a white "Verified"-style checkmark icon for the "published an analysis" /
      "released new financial results" rows (an official/verified-source visual cue).
    - Announcement text: Poppins Regular **18px**, color `#000000` (pure black — same inconsistency
      flagged on `select-community/`; verify vs. `#153d3a` before hardcoding).
    - Timestamp (e.g. "Just now", "5 min ago", "10 min ago", "1h ago"): Poppins Regular **16px**, `#000000`.
    - "View" button (far right): pill, gradient fill **"Gredient 2"**, cornerRadius fully rounded (999),
      padding ~7px vertical / 16px horizontal, label Nunito SemiBold 13-14px `#ffffff`.
  - Divider (`Rectangle 42099`, `w:1140 h:2`, fill `#d9d9d9` — a new flat gray, distinct from the shared
    `#ede9e2` hairline color used elsewhere) separates "Recent" from "Previous".
- **"Previous" section**: same heading style (no red dot), 3 more cards identical in structure
  ("shared a new market insight" ×2, "released new financial results" — all "1d ago").

### Mobile (402x1105)
- **Top bar** (fill `#f4f2ee`, matching the near-duplicate bg seen in `live-feed/` mobile): back arrow,
  "Swing Alpha" chip, logout icon button (bordered, border `#e0ddd8`), search input (Inter Regular
  placeholder — same Inter/Nunito mismatch as `live-feed/`), "Refresh" pill button.
- **"Announcement" H1**: Poppins **Bold** **22px**, `#153d3a` — note this is Bold on mobile vs. SemiBold
  20px on desktop for the equivalent page heading.
- **"Recent" section**: heading Poppins SemiBold 18px `#153d3a` + red dot (`#dc2626`).
  - Cards (`Rectangle 42095/42096/42097`, full-width, `h:108`), cornerRadius **20px**, fill `#ffffff`.
  - Avatar circles 41x41 (same plain-vs-verified-checkmark treatment as desktop).
  - Announcement text: Poppins Regular **12px**, `#000000` — a much smaller size than desktop's 18px
    (more than just a proportional mobile scale-down; verify wrapping/line-count against the screenshot).
  - Timestamp: Poppins Regular **~9-9.67px**, `#000000`.
  - "View" button: pill, gradient "Gredient 2", cornerRadius fully rounded (~603.92), padding
    ~4.23/9.67px, label Nunito SemiBold **9px** `#ffffff`.
  - Divider `#d9d9d9`, then "Previous" section (same structure, "Previous " heading — note a trailing
    space in the Figma layer's actual text content).
- **Bottom tab bar**: same four tabs as other mobile screens (Feed/Announcement/Recommendation/My
  Threads), but here **"Announcement" is the active tab** — active-tab icon sits in a solid `#108b8b`
  filled circle (vs. the pill-badge-with-translucent-background treatment on other screens), label Inter
  Medium 11px `#108b8b`; the active tab's count badge ("3") is a **solid** `#108b8b` pill with white text,
  whereas inactive tabs' badges use the translucent `#7a8a8033` pill with `#153d3a` text — a real
  active/inactive badge-style distinction worth implementing consistently.
- A stray off-canvas group (`2652:8768`, bounds far outside the visible frame, ~20919x6658px) exists in
  the Figma layer tree — this is very likely a design-file artifact (e.g. leftover duplicate content
  dragged off-canvas) and not part of the rendered screen; ignore it.

## Colors used on this screen

Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#7a8a80`, `#a0a89e`, `#ede9e2`,
`#d6d2c8`/`#e0ddd8` (border variants). Gradient "Gredient 2" on "View" buttons.

Screen-specific:
- `#dc2626` — unread indicator dot (more saturated than the shared `#e05050` error color).
- `#d9d9d9` — section divider (flat gray, distinct from shared `#ede9e2`).
- `#000000` — announcement/timestamp text (pure black, consistent with the `select-community` screen's
  same pattern — flag as a recurring inconsistency vs. `#153d3a`).

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Color |
|---|---|---|---|---|
| Page heading | Poppins | SemiBold (desktop) / Bold (mobile) | 20px / 22px | `#153d3a` |
| Section heading ("Recent"/"Previous") | Poppins | SemiBold | 18px | `#153d3a` |
| Announcement text | Poppins | Regular | 18px / 12px | `#000000` |
| Timestamp | Poppins | Regular | 16px / 9-9.67px | `#000000` |
| "View" button label | Nunito | SemiBold | 13-14px / 9px | `#ffffff` |
| "Refresh" button label | Nunito | SemiBold | 13px | `#ffffff` |
| Bottom tab label (mobile) | Inter | Medium | 11px | `#108b8b` (active) / `#888880` (inactive) |

## Component measurements

- **Announcement card**: cornerRadius 20px, fill `#ffffff`, full-width (minus side padding), fixed height
  87px (desktop) / 108px (mobile) — no explicit padding/shadow values returned; treat as a simple flat
  card, verify shadow presence against the screenshot.
- **Avatar icon**: 56px (desktop) / 41px (mobile), fully rounded; "verified" variant uses `#153d3a` fill
  with a white checkmark glyph.
- **"View" button**: fully rounded pill, gradient "Gredient 2" fill, padding ~7/16px (desktop), ~4.2/9.7px (mobile).
- **"Refresh" button**: fully rounded pill, fill `#153d3a`, border `#ffffff` (desktop) / no border shown (mobile), padding 7/16px.
- **Unread dot**: 7x7px circle, fill `#dc2626`.

## Figma node IDs

- Desktop top-level frame: `2650:8055` ("MacBook Pro 14\" - 74")
- Mobile top-level frame: `2652:8668` ("iPhone 16 & 17 Pro - 15")

## Notes

- Announcement/timestamp text color is pure `#000000` rather than the file's usual `#153d3a` — recurring
  pattern also seen on `select-community/`; confirm intent before hardcoding black vs. the dark teal token.
- Mobile announcement copy renders at a much smaller size (12px) than desktop (18px) — larger than a
  typical responsive scale-down; double check against the screenshot for text truncation/wrapping.
- Active vs. inactive bottom-tab badge styling differs (solid vs. translucent pill) — implement both states.
