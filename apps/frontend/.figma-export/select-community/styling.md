# Select Community — Post-Login Community Picker

Post-login screen shown to multi-community members, letting them choose which community to enter. Shows
two community cards (image header + member count badge, category tag, title, description, feature chips,
"Enter Community" pill CTA).

## Frame dimensions

- Desktop: **1512 x 982** px ("MacBook Pro 14\" - 23")
- Mobile: **402 x 1209** px ("iPhone 16 & 17 Pro - 12") — taller than the standard 874px iPhone frame since content stacks vertically and scrolls.

## Layout structure

### Desktop (1512x982)
- **Top header row** (`2430:1217`, at `x:1222 y:45`): "Welcome back" text (Nunito Regular 13px `#7a8a80`) + circular avatar placeholder (`cornerRadius:999`) + a bordered circular logout button (border `#d6d2c8`, icon stroke `#7a8a80`, size 36x36).
- **Page heading block** (`2430:1199`, centered, `x:536 y:130, w:451.19`):
  - "Select Community" badge/eyebrow: small check icon + label, Nunito SemiBold 13px, letter-spacing 0.65px, `#108b8b`.
  - H1 "Where would you like to go today?" (`2430:1209`): Poppins Bold **44px**, line-height 55px, center-aligned, fill reported as "mixed" (likely two-tone treatment, e.g. one line/word in an accent color similar to login's "Community" highlight — verify against screenshot).
  - Subtext "You have access to both communities. Each community has completely separate content." — Nunito Regular **15px**, line-height 25.5px, `#153d3a`, centered.
- **Community cards row** (`2430:1226`, `x:241 y:369, w:981.42 h:475.37`): two cards side-by-side, each `w:443.68` (desktop), gap ~48px between them, each card is a "Background+VerticalBorder+Shadow" frame, cornerRadius **20.45px**, fill `#ffffff`:
  - **Image header** (~232px tall): a photo/illustration area (no solid hex fill returned — likely an image fill not exposed by this node read) with a member-count pill badge overlaid at bottom-left ("248 Members" / "312 Members"), pill fill `#108b8b`, cornerRadius fully rounded, text Nunito SemiBold **11.25px**, `#ffffff`.
  - Category eyebrow ("Long-term Investing" / "Short-term Trading"): Nunito SemiBold 11.25px, letter-spacing 0.67px, `#108b8b`.
  - Card title ("Investor Community" / "Swing Alpha Community"): Poppins Bold **22px**, line-height ~27px, `#000000` (pure black — note this differs from the `#153d3a` used for headings elsewhere; flagged as screen-specific).
  - Description copy: Nunito Regular 14px, line-height ~19.42px, `#000000`.
  - Feature chip row (e.g. "Research"/"Portfolio"/"Long-term" or "Trade Alerts"/"Swing Calls"/"Live Updates"): each chip is a bordered pill, border `#153d3a`, fill `#ffffff`, cornerRadius fully rounded, text Nunito SemiBold 12px `#153d3a`.
  - "Enter Community" button: full-width pill, gradient fill **"Gredient 2"**, cornerRadius `1021.29` (pill), padding ~13.29px vertical / 24.54px horizontal, label Nunito Bold 14px `#ffffff` + arrow-right icon.
- **Bottom disclaimer row** (`2430:1212`, centered, below the cards): lock icon + "You only see content from the community you enter. Communities are completely private from each other." — Nunito Regular **12px**, line-height ~15.7px, `#a0a89e`, centered.

### Mobile (402x1209)
Same content, fully stacked vertically (single column):
1. Top row: avatar placeholder + "Select Community" badge (Nunito SemiBold 13px `#108b8b`) at top-left, "Welcome back" text + logout icon button at top-right.
2. H1 "Where would you like to go today?" — Poppins Bold **34px**, line-height ~37px, left-aligned on mobile (vs. centered on desktop) — a real alignment difference to note.
3. Subtext below heading — Nunito Regular **10–12px**, `#153d3a`.
4. Card 1 (Investor Community, node `2650:6082`) full-width, cornerRadius **17.23px**.
5. Card 2 (Swing Alpha Community, node `2650:6108`) full-width, cornerRadius **17.23px**, stacked directly below card 1.
6. Bottom disclaimer row with lock icon, Nunito Regular 12px `#a0a89e`.

Card internals scale down proportionally: member badge Nunito SemiBold ~9.5–10px, category eyebrow 10px,
title Poppins Bold **18px**, description 12px, chips Nunito SemiBold 11px, button label Nunito Bold 12px.

## Colors used on this screen
Shared tokens: `#108b8b`, `#f5f3ed` (page bg), `#ffffff`, `#153d3a`, `#a0a89e`, `#7a8a80`, `#d6d2c8`
(logout button border). Gradient "Gredient 2" on "Enter Community" buttons.
Screen-specific: `#000000` pure black for card title/description text (elsewhere in the file, headings
use `#153d3a` instead of pure black — worth confirming this is intentional vs. a design inconsistency
before hardcoding `#000000`).

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Line-height (desktop / mobile) | Color |
|---|---|---|---|---|---|
| "Select Community" eyebrow | Nunito | SemiBold | 13px | 18.57px | `#108b8b` |
| H1 heading | Poppins | Bold | 44px / 34px | 55px / 37px | mixed/likely two-tone (verify) |
| Heading subtext | Nunito | Regular | 15px / 10-12px | 25.5px / 15.07px | `#153d3a` |
| "Welcome back" | Nunito | Regular | 13px | 18.57px | `#7a8a80` |
| Member count badge | Nunito | SemiBold | 11.25px / ~9.5-10px | 16.87px / 14.22px | `#ffffff` on `#108b8b` pill |
| Card category eyebrow | Nunito | SemiBold | 11.25px / 10px | 15px / 12.64px | `#108b8b` |
| Card title | Poppins | Bold | 22px / 18px | 27px / 22.75px | `#000000` |
| Card description | Nunito | Regular | 14px / 12px | 19.42px / 16.37px | `#000000` |
| Feature chip | Nunito | SemiBold | 12px / 11px | 15px / 12.64-16.21px | `#153d3a` on `#ffffff` bordered pill |
| Button label | Nunito | Bold | 14px / 12px | 18.98px / 16px | `#ffffff` |
| Bottom disclaimer | Nunito | Regular | 12px | 15.7px | `#a0a89e` |

## Component measurements

- **Community card**: cornerRadius 20.45px (desktop) / 17.23px (mobile), fill `#ffffff`, drop shadow implied by layer name "Background+VerticalBorder+Shadow" (exact shadow spec not returned — approximate as a soft card shadow), plus a subtle vertical border per the layer name.
- **Member count badge**: fully rounded pill, fill `#108b8b`, padding ~3.07/12.27px (desktop).
- **Feature chip**: fully rounded pill, border 1px `#153d3a`, fill `#ffffff`, padding ~3.07/12.27px (desktop), ~2.6/10.34px (mobile).
- **"Enter Community" button**: fully rounded pill (raw cornerRadius 1021.29 desktop / 860.89 mobile), gradient "Gredient 2" fill, padding ~13.29/24.54px (desktop), ~11.2/20.68px (mobile).
- **Logout icon button** (desktop top-right, node `2430:1222`): circular, 36x36px, border `#d6d2c8`, fill `#ffffff`.

## Figma node IDs

- Desktop top-level frame: `2430:1198` ("MacBook Pro 14\" - 23")
- Mobile top-level frame: `2650:6064` ("iPhone 16 & 17 Pro - 12")

## Notes

- The card image header area's fill wasn't returned as a raw hex by `get_node` (likely a raster/image
  fill) — reference the screenshot directly for the actual imagery/color treatment there.
- No specific behavioral annotations were present on this screen in Figma beyond the on-canvas copy
  already captured above (the two disclaimer/helper text blocks).
