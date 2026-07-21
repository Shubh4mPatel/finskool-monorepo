# Login — Member Login Form

Member login screen (email/password) with a dark hero panel ("Welcome Back") on desktop. On mobile
the hero panel and the form stack vertically instead of side-by-side.

## Frame dimensions

- Desktop: **1512 x 982** px ("MacBook Pro 14\" - 122")
- Mobile: **402 x 874** px ("iPhone 16 & 17 Pro - 1")

## Layout structure

### Desktop (1512x982)
- **Left dark hero panel** ("Background", node `2595:40621`): `x:0 y:0, w:739.93 h:982`, fill `#153d3a`, padding 45.67px all sides (except left/right which come from an inner 54.81px padding on the content container).
  - Inner content container (`2595:40622`): `x:54.81 y:86.78, w:630.31 h:828.99`.
  - Heading "Welcome Back 👋" (`2595:40637`): Poppins Bold, **68px**, line-height ~73.13px, color `#ffffff`, positioned at container top (y:280.22 relative to panel).
  - Subtext "Access your private investment community. Your phone number must be pre-approved." (`2595:40635`): Nunito Regular 18px, line-height ~29.8px, color `#ffffff`.
  - Decorative outline icons (chart, chart-2, graph, diagram, trend-up) scattered around the panel, stroke/fill `#c1f26e`.
  - Footer caption "Your identity is always private" (`2595:40641`): Nunito Regular 13.7px, line-height ~20.55px, color `#5a8a80`, near bottom of panel.
- **Right form card** ("Background+Shadow", node `2595:40648`): `x:881 y:199, w:451.11 h:584.3` (frame-relative to the whole screen; card itself starts at local x:0). CornerRadius **21.48px**, fill `#ffffff`, padding **42.96px** top/left/right, **34.37px** bottom (drop shadow implied by layer name "Background+Shadow" — exact shadow params not exposed by this node read; treat as a soft card shadow, e.g. `0 10px 30px rgba(0,0,0,0.08)` as a reasonable approximation).
  - "Member Login" badge (small clock/check icon + label) at top, Nunito SemiBold 14px, color `#108b8b`, letter-spacing 0.56px.
  - Heading: two stacked lines "Login to your" (`#153d3a`) / "Community" (`#85cd78`) — Poppins Bold **30px**, line-height ~37.6px.
  - Email field: label "Email Address" (Nunito SemiBold 14px, `#153d3a`), input box height ~50.48px, cornerRadius **10.74px**, border `#d6d2c8`, fill `#ffffff`, inner padding ~13.96px vertical / 15.04px horizontal, placeholder "Enter your e mail address" Nunito Regular 14px `#b0aba1`.
  - Password field: label "Password" (same style as email label), same input box dimensions, includes a show/hide eye icon (stroke `#a0a89e`) at right, ~18.26x18.26px.
  - "Forgot Password?" link, right-aligned, Nunito SemiBold 14px, color `#108b8b`.
  - Primary button "Login to Community" (node `2595:40680`): full-width pill, fill = gradient style **"Gredient 2"** (`#c1f26e` → `#108b8b`), cornerRadius `1073` (raw huge value = fully rounded/pill), padding 16.11px vertical / 34.37px horizontal, label Nunito Bold 16px `#ffffff` letter-spacing 0.32px, plus a small arrow-right icon (white) after the label.
  - Divider line (`#ede9e2`, 1.07px thick) below the button.
  - Trust row: small lock icon (stroke `#a0a89e`) + "Your details are never shared with other members", Nunito Regular 12px, color `#a0a89e`.
  - Below the card (outside it, at screen level): "Don't have an account? [Sign up]" — plain text Nunito Regular 14px `#7a8a80`, and a "Sign up" pill link with `#108b8b` border + text, Nunito SemiBold 14px, cornerRadius fully rounded, padding 7.52px vertical / 23.63px horizontal.

### Mobile (402x874)
Single-column, vertically stacked (no side-by-side panels): hero copy is at the top of the page on the
light background (not inside a dark panel on this mobile variant), then the white form card below, then
the "Sign up" prompt at the bottom.
- Heading "Welcome Back 👋" at `x:15 y:110`, Poppins Bold **34px**, line-height ~37px, color `#153d3a` (note: dark text on light bg here, unlike the desktop's white-on-dark-panel treatment).
- Subtext at `x:15 y:187.92`: Nunito Regular **10px**, color `#153d3a`.
- Form card ("Background+Shadow", node `2595:40731`): `x:15 y:247, w:372 h:448`, cornerRadius **17.71px**, fill `#ffffff`, padding 35.43px top/left/right, 28.34px bottom.
  - Same field structure as desktop but scaled down: labels Nunito SemiBold **12px**, inputs cornerRadius **8.86px**, border `#d6d2c8`, placeholder Nunito Regular 12px `#b0aba1`.
  - Primary button "Login to Community": Nunito Bold **14px**, cornerRadius `884.83` (pill), padding 13.29px vertical / 28.34px horizontal, gradient "Gredient 2" fill.
  - "Forgot Password?" Nunito SemiBold 12px `#108b8b`.
  - Trust row text Nunito Regular **10px** `#a0a89e`.
- Below card: "Don't have an account? [Sign up]" pill, same structure as desktop scaled to 12px text.

## Colors used on this screen
All from the shared palette: `#153d3a`, `#108b8b`, `#c1f26e`, `#85cd78`, `#f5f3ed` (page bg), `#ffffff`,
`#d6d2c8`, `#b0aba1`, `#a0a89e`, `#7a8a80`, `#5a8a80`, `#ede9e2`. Gradient "Gredient 2" on the primary button.
No screen-specific colors beyond the shared set.

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Line-height (desktop / mobile) | Color |
|---|---|---|---|---|---|
| Hero heading | Poppins | Bold | 68px / 34px | 73.13px / 36.98px | `#ffffff` (desktop, on dark panel) / `#153d3a` (mobile, on light bg) |
| Hero subtext | Nunito | Regular | 18px / 10px | 29.8px / 15.07px | `#ffffff` (desktop) / `#153d3a` (mobile) |
| Panel footer caption | Nunito | Regular | 13.7px / n/a | 20.55px | `#5a8a80` |
| Badge "Member Login" | Nunito | SemiBold | 14px / 12px | 19.95px / 16.45px | `#108b8b` |
| Card heading | Poppins | Bold | 30px / 24px | 37.59px / 31px | `#153d3a` + `#85cd78` (2nd line) |
| Field label | Nunito | SemiBold | 14px / 12px | 19.95px / 16.45px | `#153d3a` |
| Field placeholder | Nunito | Regular | 14px / 12px | 19.95px / 16.45px | `#b0aba1` |
| "Forgot Password?" | Nunito | SemiBold | 14px / 12px | 19.95px / 16.45px | `#108b8b` |
| Button label | Nunito | Bold | 16px / 14px | 24.17px / 19.93px | `#ffffff` |
| Trust row text | Nunito | Regular | 12px / 10px | 15.76px / 12.99px | `#a0a89e` |
| "Don't have an account?" | Nunito | Regular | 14px / 12px | 19.95px / 16.45px | `#7a8a80` |
| "Sign up" link | Nunito | SemiBold | 14px / 12px | 19.95px / 16.45px | `#108b8b` |

## Component measurements

- **Input fields**: height ~50.48px (desktop) / ~41.63px (mobile); cornerRadius 10.74px (desktop) / 8.86px (mobile); border 1px `#d6d2c8`; fill `#ffffff`; inner padding ~13.96px/15.04px (desktop), ~11.51px/12.4px (mobile).
- **Primary button**: fully rounded pill (raw cornerRadius 1073 desktop / 884.83 mobile — treat as pill); gradient fill "Gredient 2"; padding 16.11/34.37px (desktop), 13.29/28.34px (mobile).
- **Secondary "Sign up" pill**: border-only (1px `#108b8b`), no fill, fully rounded, padding 7.52/23.63px (desktop), 6.2/19.49px (mobile).
- **Form card**: cornerRadius 21.48px (desktop) / 17.71px (mobile), fill `#ffffff`, padding ~42.96px (desktop) / ~35.43px (mobile), soft drop shadow (exact shadow spec not returned by node read — approximate).

## Figma node IDs

- Desktop top-level frame: `2595:40620` ("MacBook Pro 14\" - 122")
- Mobile top-level frame: `2595:40730` ("iPhone 16 & 17 Pro - 1")

## Notes

- No behavioral annotations recorded on this screen in Figma.
- Desktop treats the hero copy as white text on a full-height dark teal panel; mobile instead puts the
  hero copy directly on the page's light background (`#f5f3ed`) with dark text — this is a real layout
  difference, not just a scaled-down version of the same panel.
