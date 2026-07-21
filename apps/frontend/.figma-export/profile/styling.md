# Profile — Base Profile Page

Base profile page: avatar (with camera/edit overlay), name/email, community chip, "Member Since" date,
an "Active Subscription" status card, a "New Post Alerts" notification toggle, Phone/Email fields
(phone read-only), and "Edit Details" / "Change Password" action buttons.

## Frame dimensions

- Desktop: **1512 x 1008** px ("MacBook Pro 14\" - 18")
- Mobile: **402 x 900** px ("iPhone 16 & 17 Pro - 9")

## Layout structure

### Desktop (1512x1008)
- **Left nav sidebar**: identical pattern to other screens (no item is highlighted/active in this dump —
  profile is reached via the top-right avatar, not a sidebar nav item).
- **Profile card** (`x:321 y:62, w:981 h:450`): sits below a colored top banner strip (`x:321 y:50, w:981
  h:64`, fill `#108b8b`, cornerRadius "mixed" — top corners rounded to match the card below, bottom
  corners square where the avatar overlaps it).
  - Avatar: 68x68 circle, placeholder fill, with a small camera/edit icon overlay (bottom-right, fill
    `#108b8b`, white camera glyph) for changing the profile photo.
  - Name "Ritesh Kumar": Nunito Bold **18px**, `#153d3a`.
  - Email "ritesh@example.com": Nunito Regular 11px, `#a0a89e`.
  - Small "Edit" pill (top-right of card, `x:827 y:59`): fill `#153d3a` at ~20% alpha (`#153d3a33`),
    cornerRadius fully rounded, text "Edit" Poppins Regular 10px `#153d3a` + edit-2 pencil icon.
  - **Meta row** (3 columns separated by vertical dividers `#ede9e2`): "Member Since" (label Nunito
    Regular 11px `#a0a89e`, value "12 May 2026" Nunito Bold 13px `#153d3a`) | "Community" (label same
    style, value = "Swing Alpha" chip — bordered pill, fill `#c1f26e1a`, border `#c1f26e`, Nunito Regular
    10px `#153d3a`).
  - Horizontal divider `#ede9e2` below the meta row.
  - **Active Subscription card** (`Background+VerticalBorder`, cornerRadius **~7.81px**, fill `#edfad4`):
    crown icon in a dark `#153d3a` circle (26px), "Active Subscription" label (Nunito Bold ~10.16px,
    `#153d3a`) with a small green status dot (`#4caf50`), "Expires: 15 Aug 2026" (Nunito Regular ~8.6px,
    `#5a7a50` — a new muted olive-green not in the shared palette), and right-aligned "92 days remaining"
    (Nunito SemiBold ~8.6px, `#108b8b`).
  - **"New Post Alerts" toggle row**: label "New Post Alerts" (Nunito SemiBold 13px `#153d3a`) + helper
    "Get notified when admin publishes a new post" (Nunito Regular 11px `#a0a89e`) + a toggle switch on
    the right (track fill `#c1f26e`, cornerRadius fully rounded, white circular thumb with its own subtle
    shadow, positioned right = "on" state). **Note**: this single toggle already appears on the base
    profile page, not only on `profile-settings/` — the settings screen expands this into a fuller
    Notifications section (see that screen's styling.md).
  - **Phone Number field** (left column) + **E-mail Address field** (right column), laid out side-by-side
    in a two-column row on desktop: each label Nunito SemiBold 13px `#153d3a`; input box fill `#f8f7f5`
    (a new near-white token, distinct from the shared `#ffffff` input fill used on login/signup),
    cornerRadius **10px**, border `#d6d2c8`, value text Nunito Regular 13px `#000000` (e.g.
    "+919898989890", "meghna@example.com" — note the email placeholder value doesn't match the header's
    "ritesh@example.com", likely a mock-data inconsistency in the Figma file, not a design decision).
    Helper text under the phone field: "Phone number cannot be changed. Contact admin." — Nunito Regular
    11px `#a0a89e`.
  - **Footer action row** (fill `#f8f7f5`, full width): "Edit Details" button (gradient **"Gredient 2"**
    pill, cornerRadius fully rounded, label Nunito SemiBold 13px `#ffffff` + pencil icon) and "Change
    Password" button (bordered pill, border `#108b8b`, label Nunito SemiBold 13px `#108b8b` + lock icon).

### Mobile (402x900)
- Top bar (fill `#f4f2ee`): logout button (bordered circle, border `#e0ddd8`), "Swing Alpha" chip.
- **Profile card** (`Rectangle 42094`, `x:14 y:132, w:373 h:594`): fill `#ffffff`, cornerRadius **20px**,
  **border `#108b8b`** (unlike desktop, which has no visible card border — mobile explicitly outlines the
  card in teal).
  - Avatar 68x68 (same camera-overlay treatment), name Nunito Bold 18px `#153d3a`, email Nunito Regular
    11px `#a0a89e`, "Edit" pill top-right (same `#153d3a33` bg treatment).
  - Meta row: "Member Since" / "Community" (Swing Alpha chip), separated by a vertical divider — same
    content as desktop, laid out in the same two-column pattern (not further stacked despite the narrower
    viewport).
  - Divider, then Active Subscription card — identical styling to desktop.
  - "New Post Alerts" toggle row — identical styling to desktop.
  - **Phone Number** and **E-mail Address** fields are **stacked vertically** here (not side-by-side as on
    desktop) — label, then input (fill `#f8f7f5`, cornerRadius 10px, border `#d6d2c8`), Phone's helper
    text directly below it, then Email field below that.
  - Footer action row: "Edit Details" (gradient pill, cornerRadius fully rounded, Nunito SemiBold **12px**
    white) and "Change Password" (bordered pill, `#108b8b` border/text, Nunito SemiBold 12px) — same
    styling as desktop, scaled down.
- **Bottom tab bar**: present (Feed/Announcement/Recommendation/My Threads) but **no tab is shown active**
  on this screen — consistent with Profile being reached via the avatar rather than being one of the four
  primary bottom-tab destinations.

## Colors used on this screen

Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#a0a89e`, `#ede9e2`, `#d6d2c8`,
`#4caf50`, `#edfad4`. Gradient "Gredient 2" on "Edit Details".

Screen-specific: `#f8f7f5` (input field fill — distinct from the shared white input fill used on
login/signup forms), `#5a7a50` (subscription "Expires" text), `#153d3a33` (20%-alpha "Edit" pill
background), `#e0ddd8` (mobile logout border), `#f4f2ee` (mobile top bar bg, same as other mobile screens).

## Typography table

| Role | Font | Weight | Size | Color |
|---|---|---|---|---|
| Name | Nunito | Bold | 18px | `#153d3a` |
| Email (header) | Nunito | Regular | 11px | `#a0a89e` |
| "Edit" pill label | Poppins | Regular | 10px | `#153d3a` |
| Meta label | Nunito | Regular | 11px | `#a0a89e` |
| Meta value | Nunito | Bold | 13px | `#153d3a` |
| Community chip | Nunito | Regular | 10px | `#153d3a` |
| "Active Subscription" label | Nunito | Bold | ~10.16px | `#153d3a` |
| Subscription expiry | Nunito | Regular | ~8.6px | `#5a7a50` |
| Subscription days remaining | Nunito | SemiBold | ~8.6px | `#108b8b` |
| Toggle row label | Nunito | SemiBold | 13px | `#153d3a` |
| Toggle row helper | Nunito | Regular | 11px | `#a0a89e` |
| Field label | Nunito | SemiBold | 13px | `#153d3a` |
| Field value | Nunito | Regular | 13px | `#000000` |
| Field helper text | Nunito | Regular | 11px | `#a0a89e` |
| "Edit Details" label | Nunito | SemiBold | 13px / 12px (mobile) | `#ffffff` |
| "Change Password" label | Nunito | SemiBold | 13px / 12px (mobile) | `#108b8b` |

## Component measurements

- **Top banner strip** (desktop only): fill `#108b8b`, height 64px, top corners rounded to match the card.
- **Avatar**: 68x68px, fully rounded, camera-edit icon overlay bottom-right.
- **Active Subscription card**: cornerRadius ~7.81px, fill `#edfad4`, padding ~12.5/11/9.4px.
- **Toggle switch**: fully rounded track (fill `#c1f26e` = on-state), circular white thumb (~18px) with
  its own drop shadow.
- **Input field**: height 44px, cornerRadius 10px, fill `#f8f7f5`, border 1px `#d6d2c8`.
- **"Edit Details" / "Change Password" buttons**: fully rounded pill, gradient "Gredient 2" (Edit Details)
  or border-only `#108b8b` (Change Password), padding ~9/18px (desktop), ~8.3/16.6px (mobile).
- **Mobile profile card border**: 1px `#108b8b` — a mobile-only outline not present on desktop.

## Figma node IDs

- Desktop top-level frame: `2410:1553` ("MacBook Pro 14\" - 18")
- Mobile top-level frame: `2650:6925` ("iPhone 16 & 17 Pro - 9")

## Notes

- The email shown in the input field ("meghna@example.com") doesn't match the header's email
  ("ritesh@example.com") — this is a mock-data mismatch in the Figma file, not an intentional design
  choice; use one consistent placeholder when building.
- The "New Post Alerts" toggle already appears on this base profile page; `profile-settings/` shows an
  expanded Notifications section with additional toggles (Subscription Reminders) — treat this screen's
  toggle as a subset/preview of that fuller settings section.
