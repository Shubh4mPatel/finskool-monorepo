# Live Feed — Main Feed (Nav Sidebar + Post Cards + Widgets)

Main community feed screen. Desktop: left nav sidebar (Feed/Announcements/Recommendations/My Threads/Logout),
center post-card column, right widget column (Market Today + Community Rules). Mobile: top search/filter
bar, stacked post cards, bottom tab bar (Feed/Announcement/Picks/My Threads), plus a hamburger nav-drawer
overlay variant (`nav-drawer.png`).

## Frame dimensions

- Desktop: **1512 x 933** px ("MacBook Pro 14\" - 57")
- Mobile: **402 x 1505** px ("iPhone 16 & 17 Pro - 3") — tall scrollable capture (device viewport is 402x874; this captures the full scrollable feed content)
- Mobile nav-drawer variant: **402 x 874** px ("iPhone 16 & 17 Pro - 6") — screenshot only, no node detail pulled (see Process Notes)

## Layout structure

### Desktop (1512x933)
- **Left nav sidebar** (`2541:3788`, "Background+Shadow"): `x:31 y:29, w:269 h:875`, cornerRadius **16px**, fill `#ffffff`, padding 24/16/16/20 (top/left-right/bottom).
  - Top: back-arrow icon in a dark circle (`#153d3a`), plus small user/community icon block.
  - Divider line `#ede9e2` below the header block.
  - **Nav list** (`2541:3802`, "Nav", `w:188 h:756.8`): each item is a "Link" pill, full-width, cornerRadius fully rounded (raw ~1254.9), padding ~11.3px vertical / 17.6px horizontal:
    - "Feed" (active): pill fill `#153d3a`, label Nunito Bold **16px** `#ffffff`, plus a white count badge "20" (pill fill `#ffffff` at ~20% alpha i.e. `#ffffff33`, text Poppins Regular 12px `#ffffff`).
    - "Announcements" (inactive): no pill fill, label Nunito SemiBold 16px `#7a8a80`, icon stroke `#7a8a80`.
    - "Recommendations" (inactive): same inactive style, count badge "10" (pill fill `#153d3a` at ~20% alpha i.e. `#153d3a33`, text Poppins Regular 12px `#153d3a`).
    - "My Threads" (inactive): same inactive style, messages icon.
    - Two further empty "Link" placeholder rows exist in the Figma layer list below My Threads with no populated label/icon in this file revision — likely reserved slots for future nav items (not yet designed); don't assume specific copy for them.
  - Divider, then "Logout" row at the bottom: icon + "Logout" text, Nunito SemiBold 13px `#a0a89e`.
- **Top bar** (`2541:3837` area, `x:320 y:54`): "Live Feed" H2 heading (Poppins SemiBold **20px**, `#153d3a`) + search input (`2563:2357`, bordered pill, cornerRadius fully rounded, border `#108b8b`, fill `#ffffff`, placeholder "Search with Title and hashtags....." Nunito SemiBold 13px, color `#108b8b` at ~70% alpha i.e. `#108b8bb2`).
- **Filter buttons** (top right, `x:917-1141 y:59`): "Date" pill (fill `#153d3a`, border `#153d3a`, label Nunito Bold 13px `#ffffff`, calendar icon) and "Latest First" pill (fill `#153d3a`, border `#ffffff`, label Nunito SemiBold 13px `#ffffff`, dropdown chevron icon) — both cornerRadius fully rounded (999), padding ~7-10px vertical / 16-18px horizontal.
- **Center post-card column** (`x:320-864` roughly, cards ~524-680px wide): each post card is a "Background+Shadow" or "Background+HorizontalBorder+Shadow" frame, cornerRadius **16px**, fill `#ffffff`, border `#c1f26e` (thin accent border on the card), padding ~20px top / 22px left-right / 18px bottom.
  - Header row: circular avatar placeholder (38x38, cornerRadius fully rounded), author name "Ritesh Kumar" (Nunito Bold 13px `#153d3a`), optional "ADMIN" badge (pill fill `#c1f26e`, text Nunito Bold 10px `#153d3a`, letter-spacing 0.5px) for admin-authored posts, timestamp block ("9:15 AM" · clock icon · "11 Jun 2026", Nunito Regular 11px `#7a8a80`), and a 3-dot overflow menu (three `#153d3a` dots).
  - Post heading (e.g. "HDFCBANK — Accumulate on Dips Near ₹1,620" / "TATASTEEL — Breakout Confirmed. Target ₹175"): Poppins SemiBold **15-16px**, line-height ~20.2px, `#153d3a`.
  - Post body copy: Nunito Regular **13px**, line-height ~21.5px, `#5a6a60` (a distinct muted teal-gray not in the original shared token list — close to but not identical to `#5a8a80`; treat as its own token for this screen).
  - Hashtag chips (e.g. "#HDFCBANK", "#ACCUMULATE"): bordered, fill `#ffffff`, cornerRadius **6px** (squared, not pill, unlike other chips in the file), border implied `#153d3a`-ish (thin), text Nunito SemiBold 11px `#153d3a`.
  - Inline small tags without borders (e.g. "#BUY", "#SWING", "#TATASTEEL"): plain text, Nunito SemiBold 11px `#153d3a`, no background/border — used directly under the media area on the breakout-style post.
  - "View Threads (10)" link: teal `#108b8b`, font reported as "mixed" (likely regular "View" + bold "Threads (10)" — verify against screenshot), 13px, plus a chevron-down icon.
  - Some posts include a large embedded image/chart placeholder area (`Background`, cornerRadius 10px) below the body copy before the hashtag row.
- **Right widget column** (`x:864 y:129, w:280`):
  - **"Market Today" card** (`2541:3966`, "Background+Shadow"): cornerRadius **16px**, fill `#ffffff`, padding 20/20/16/20. Heading "Market Today" Poppins SemiBold 13px `#153d3a`. Rows: index name (Nunito SemiBold 13px `#153d3a`) + value (Nunito Regular 13px `#5a6a60`) + change-percent pill:
    - Positive change pill: fill `#edfad4`, text `#2d6a1a`, Nunito Bold 11px.
    - Negative change pill: fill `#fff0f0`, text `#d93030`, Nunito Bold 11px.
    - Rows shown: NIFTY 50 (24,351, +0.82%), SENSEX (80,218, +0.74%), BANK NIFTY (52,440, −0.31%), NIFTY IT (38,760, +1.24%).
    - Footer note "Prices delayed 15 min": Nunito Regular 11px, color `#e05050`.
  - **"Community Rules" card** (`2541:4004`, "Background+Shadow"): cornerRadius **16px**, fill `#ffffff`, padding 20px. Heading "Community Rules" Poppins SemiBold 13px `#153d3a`. Numbered list (01-04), each number in a small circular chip (fill `#c1f26e`, cornerRadius fully rounded, text Nunito Bold 10px `#153d3a`, centered) + rule text (Nunito Regular 13px, line-height ~19.5px, `#5a6a60`): "Do not share calls outside this group", "No personal contact requests", "Follow admin SL strictly", "Respect all members, no spam".
- **Community switcher chip** (`2580:32067`, near top): "Swing Alpha" + chevron, bordered pill, fill `#c1f26e` at ~10% alpha (`#c1f26e1a`), border `#c1f26e`, text Nunito Regular 10px `#153d3a`.

### Mobile (402x1505, scrollable)
- **Top bar** (`2650:6144`, fill `#f4f2ee` — a near-identical but distinct off-white from the shared `#f5f3ed` page background; likely meant to be the same token, verify): back arrow, "Swing Alpha" community chip (bordered pill, fill `#c1f26e1a`, border `#c1f26e`, Nunito Regular 16px `#153d3a`), avatar, logout icon button (bordered circle, border `#e0ddd8` — a near-duplicate of the shared `#d6d2c8` border color; verify).
  - Search input: bordered pill, cornerRadius fully rounded, border `#153d3a`, fill `#ffffff`, placeholder "Search with Title and hashtags....." **Inter** Regular ~13.9px, `#153d3ab2` — **note the font is Inter here, not Nunito** (see file-wide Inter/Nunito mismatch flag in design-tokens.md).
  - "Latest First" pill button: fill `#153d3a`, label **Inter** Medium 13px `#ffffff` (again Inter, not Nunito).
  - "Date" pill button: fill `#153d3a`, label **Inter** Medium 13px `#ffffff`, calendar icon.
- **Post cards** (`2650:6179` etc., "Background+HorizontalBorder+Shadow"): cornerRadius **~26.17px**, fill `#ffffff`, border `#b6e54d` (a lighter lime-green, distinct from the shared `#c1f26e` — flag as an inconsistent variant, verify against screenshot before hardcoding).
  - Avatar circle (39.26px), author name "Ritesh Kumar": **Poppins** Medium 14px, color `#143f3d` (near-duplicate of `#153d3a` — flag as likely-unintentional variant).
  - Post heading (e.g. "TATASTEEL — Breakout Confirmed. Target ₹175"): **Inter** Bold **16px**, color `#143f3d` — desktop uses Poppins SemiBold for the equivalent heading; this is the clearest instance of the Inter/Poppins font mismatch on mobile.
  - Post body copy: **Inter** Regular **14px**, color `#888880` (yet another distinct muted-gray token vs. desktop's `#5a6a60` — flag).
  - Embedded post image (`c5da450f-...jpg` placeholder node): cornerRadius **20px**.
  - Hashtag row: Nunito SemiBold 10px `#153d3a` for "#TATASTEEL"/"#SWING"/"#BUY"; timestamp Nunito Regular 11px `#7a8a80`.
  - "View Threads (10)" link: `#108b8b`, mixed weight, 13px, chevron icon.
- **Bottom tab bar** (`2650:6290`, "Background+HorizontalBorder"): fill `#ffffff`, border `#e0ddd8`, padding 8/8/24/8. Four tabs — Feed (active: icon in `#108b8b` filled circle, label Inter Medium 11px `#108b8b`), Announcement (inactive: icon stroke `#7a8a80`, label Inter Medium 11px `#888880`), Picks (inactive, same treatment), My Threads (inactive, same treatment). Count badges ("20", "5"): pill fill `#7a8a80` at ~20% alpha (`#7a8a8033`), text Poppins Regular 12px `#153d3a`.
- **Nav-drawer variant** (`nav-drawer.png`, node `2650:7027`): this is the same live-feed screen with the mobile hamburger menu open (screenshot only — no node-level styling detail was pulled for this variant per the task's reliability guidance; use it purely as a visual reference for the drawer's open/overlay state, positioning, and backdrop treatment).

## Colors used on this screen

Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#7a8a80`, `#a0a89e`, `#ede9e2`, `#e05050`.

Screen-specific (not in the shared palette — flagged for review, several look like near-duplicate/inconsistent
variants of shared tokens rather than intentional new colors):
- `#5a6a60` — post body / rule text muted color (desktop) — close to but distinct from shared `#5a8a80`.
- `#edfad4` / `#2d6a1a` — positive market-change pill (bg/text).
- `#fff0f0` / `#d93030` — negative market-change pill (bg/text).
- `#153d3a33`, `#ffffff33`, `#7a8a8033` — 20%-alpha pill backgrounds for nav/tab count badges.
- `#c1f26e1a` — 10%-alpha background for the "Swing Alpha" community chip.
- `#f4f2ee` — mobile top-bar background, near-duplicate of shared `#f5f3ed`.
- `#e0ddd8` — mobile logout/tab-bar border, near-duplicate of shared `#d6d2c8`.
- `#143f3d` — mobile post author/heading color, near-duplicate of shared `#153d3a`.
- `#888880` — mobile post body color, distinct from desktop's `#5a6a60`.
- `#b6e54d` — mobile post card border, distinct from shared `#c1f26e`.

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Color |
|---|---|---|---|---|
| "Live Feed" page heading | Poppins | SemiBold | 20px | `#153d3a` |
| Nav item (active) | Nunito | Bold | 16px | `#ffffff` |
| Nav item (inactive) | Nunito | SemiBold | 16px | `#7a8a80` |
| Search placeholder | Nunito (desktop) / **Inter** (mobile) | SemiBold / Regular | 13px / 13.9px | `#108b8bb2` / `#153d3ab2` |
| Filter button label | Nunito (desktop) / **Inter** (mobile) | Bold-SemiBold / Medium | 13px | `#ffffff` |
| Post author name | Nunito (desktop) / **Poppins** (mobile) | Bold / Medium | 13px / 14px | `#153d3a` / `#143f3d` |
| Post heading | **Poppins** (desktop) / **Inter** (mobile) | SemiBold / Bold | 15-16px | `#153d3a` / `#143f3d` |
| Post body | Nunito (desktop) / **Inter** (mobile) | Regular | 13px / 14px | `#5a6a60` / `#888880` |
| Hashtag chip | Nunito | SemiBold | 11px | `#153d3a` |
| "View Threads" link | mixed (Nunito family) | mixed/SemiBold | 13px | `#108b8b` |
| Widget heading | Poppins | SemiBold | 13px | `#153d3a` |
| Widget row label/value | Nunito | SemiBold / Regular | 13px | `#153d3a` / `#5a6a60` |
| Market change pill | Nunito | Bold | 11px | `#2d6a1a` (up) / `#d93030` (down) |
| Rule number chip | Nunito | Bold | 10px | `#153d3a` on `#c1f26e` |
| Rule text | Nunito | Regular | 13px | `#5a6a60` |
| Bottom tab label (mobile) | Inter | Medium | 11px | `#108b8b` (active) / `#888880` (inactive) |

## Component measurements

- **Sidebar / cards**: cornerRadius 16px (desktop cards + widgets), ~26.17px (mobile post cards, notably larger radius than desktop).
- **Nav pill (active/inactive)**: fully rounded, padding ~11.3px vertical / 17.6px horizontal.
- **Search input**: fully rounded pill, border 1px (`#108b8b` desktop / `#153d3a` mobile), fill `#ffffff`.
- **Filter buttons ("Date"/"Latest First")**: fully rounded pill, fill `#153d3a`, padding ~7-10px vertical / 13-18px horizontal.
- **Hashtag chip**: cornerRadius 6px (square-ish, an exception to the "chips are fully rounded" rule elsewhere in the file), border+fill `#ffffff`, padding ~2-4px vertical / 10px horizontal.
- **Market-change / rule-number pill**: fully rounded, small padding (~1-4px).
- **Community switcher chip**: fully rounded, border 1px `#c1f26e`, padding ~3-22px depending on breakpoint.

## Figma node IDs

- Desktop top-level frame: `2541:3787` ("MacBook Pro 14\" - 57")
- Mobile top-level frame: `2650:6143` ("iPhone 16 & 17 Pro - 3")
- Mobile nav-drawer variant (screenshot only): `2650:7027` ("iPhone 16 & 17 Pro - 6")

## Notes

- **Font inconsistency**: the mobile variant of this screen mixes Inter (search placeholder, filter buttons,
  post heading/body, bottom tab labels) with Nunito/Poppins (hashtags, timestamps, widget-style text) —
  this is very likely an unintentional artifact of a later design iteration rather than an intentional
  choice; confirm with the design owner before deciding whether to implement Inter for these specific
  mobile elements or normalize everything to Nunito/Poppins to match desktop.
- Several near-duplicate hex colors appear only on this screen (see Colors section) — worth reconciling
  with the shared palette rather than introducing new tokens if they're meant to be the same color.
- Two empty "Link" nav placeholder rows exist below "My Threads" in the desktop sidebar with no populated
  content in this Figma revision.
