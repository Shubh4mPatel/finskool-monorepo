# Create Account — Signup Form (Phone-Gated / Invitation Only)

Signup form (Full Name / Phone / Email / Password / Confirm) with a dark hero panel on desktop, matching
the login screen's visual language. Includes an "Invitation Only" badge and an error state shown when a
phone number is not on the pre-approved access list ("This phone number is not on the access list. Please
contact your admin.").

## Frame dimensions

- Desktop: **1512 x 982** px ("MacBook Pro 14\" - 21")
- Mobile: **402 x 874** px ("iPhone 16 & 17 Pro - 2")

## Layout structure

### Desktop (1512x982)
- **Left dark hero panel** (`2430:1279`, "Background"): `x:0 y:0, w:739.93 h:982`, fill `#153d3a`, padding 45.67px vertical, 54.81px horizontal (same construction as login).
  - Heading "Create Your Account" (`2430:1293`): Poppins Bold **68.5px**, line-height ~74px, `#ffffff`.
  - Subtext "Your phone number must be on the approved list. Enter your details to create your account." (`2430:1294`): Nunito Regular **18.27px**, line-height ~30.15px, `#ffffff`.
  - Same decorative outline icon set (chart, chart-2, graph, diagram, trend-up) in `#c1f26e` as login.
  - Footer caption "Your identity is always private": Nunito Regular 13.7px, `#5a8a80`.
- **"Invitation Only" badge** (`2430:1377`, standalone, above the card): small padlock/check icon + label, positioned at `x:850 y:193.97` (screen-relative), Nunito SemiBold **13.27px**, letter-spacing 0.66px, color `#108b8b`.
- **Error message box** (`2430:1370`, "Background+Border", desktop only): `x:895.95 y:99, w:441.14 h:72.5`, fill `#fff5f5`, cornerRadius **10.21px**, padding ~14.3px, contains an alert-circle icon (stroke `#e05050`) + copy "This phone number is not on the access list. Please contact your admin." (Nunito Regular 14px, line-height ~20.58px, `fills:"mixed"` in the raw data — appears to mix a darker error-red/near-black tone across the two lines; treat as an error-toned text color, e.g. `#e05050`/`#7a2d2d`-ish, verify against screenshot).
- **Form card** (`2430:1305`, "Background+Shadow"): `x:850 y:229.71, w:531 h:589.21`, cornerRadius **20.42px**, fill `#ffffff`, no explicit padding on the outer card frame (padding lives on the inner field containers, ~44.93px left inset for fields).
  - "Full Name" field: label Nunito SemiBold 14px `#153d3a`; input height ~48px, cornerRadius **10.21px**, border `#d6d2c8`, placeholder "Enter your full name" Nunito Regular 14px `#b0aba1`.
  - "Phone Number" field: same label style; input has a dark `#153d3a` country-code chip ("+91" + chevron, Nunito Bold 13.27px `#ffffff`) fused to the left of a white input area, all inside one bordered container (cornerRadius 10.21px, border `#d6d2c8`); placeholder "Enter your phone number"; helper text below: "Must match the number your admin registered for you" — Nunito Regular 12px `#a0a89e`.
  - "Email Address" field: same structure as Full Name.
  - Password row: two side-by-side half-width fields — "Set Password" and "Confirm Password", each ~212.4px wide, masked value shown as bullets (Nunito Regular 13.27px `#b0aba1`), each with a show/hide eye icon (stroke `#a0a89e`).
  - Primary button "Create My Account" (`2430:1351`): full-width pill, cornerRadius `1020.13` (fully rounded — raw huge value, treat as pill), padding 16.34px vertical / 32.68px horizontal, label Nunito Bold **15.32px** letter-spacing 0.31px `#ffffff`, arrow-right icon after label. Note: this node's raw fill/fillStyle was not returned by this `get_node` call (only cornerRadius+padding came back) — visually it matches the same "Gredient 2" gradient pill used on the login screen's "Login to Community" button; treat as the same gradient unless the screenshot shows otherwise.
  - Trust row: lock icon + "Your personal details are never visible to other members", Nunito Regular 12px `#a0a89e`.
  - Below card: "Already registered? [Login]" — Nunito Regular 14px `#7a8a80` + a bordered pill link "Login" (border `#108b8b`, text Nunito SemiBold 14px `#108b8b`).

### Mobile (402x874)
Single column, stacked, on the light `#f5f3ed` background (no dark hero panel on mobile, matching the
login screen's mobile pattern):
- Heading "Create Your Account" at `x:16 y:119`: Poppins Bold **34px**, line-height ~37px, `#153d3a`.
- Subtext at `x:16 y:196.92`: Nunito Regular **10px**, `#153d3a`.
- "Invitation Only" badge (`2569:6547`) sits standalone above the card, same icon+label pattern, Nunito SemiBold **10px**, `#108b8b`. **Note:** the mobile variant only shows this badge — it does **not** include the red error message box ("not on the access list...") that appears on desktop. Treat the full error-box copy as a desktop-only (or conditionally-rendered) element; confirm with product whether mobile should also show it.
- Form card (`2569:6488`, "Background+Shadow"): cornerRadius **14.31px**, fill `#ffffff`, contains the same fields scaled down:
  - Labels Nunito SemiBold **12px**; inputs cornerRadius **7.16px**, border `#d6d2c8`; placeholders Nunito Regular 10–12px `#b0aba1`.
  - Password/Confirm Password fields are still side-by-side (each ~148.86px wide) even at mobile width — a tight fit, worth double-checking against the actual screenshot for wrapping behavior.
  - Primary button "Create My Account": Nunito Bold **14px**, cornerRadius `714.97` (pill), padding 11.45px vertical / 22.9px horizontal.
  - Trust row text Nunito Regular **10px** `#a0a89e`.
- Below card: "Already registered? [Login]" pill, Nunito Regular/SemiBold **12px**.

## Colors used on this screen
Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#d6d2c8`, `#b0aba1`, `#a0a89e`,
`#7a8a80`, `#5a8a80`. Screen-specific: `#e05050` (error icon stroke), `#fff5f5` (error message box background,
desktop only) — both already catalogued in the shared token list as the error pair.

## Typography table

| Role | Font | Weight | Size (desktop / mobile) | Line-height (desktop / mobile) | Color |
|---|---|---|---|---|---|
| Hero heading | Poppins | Bold | 68.5px / 34px | 74px / 37px | `#ffffff` (desktop) / `#153d3a` (mobile) |
| Hero subtext | Nunito | Regular | 18.27px / 10px | 30.15px / 15.07px | `#ffffff` (desktop) / `#153d3a` (mobile) |
| "Invitation Only" badge | Nunito | SemiBold | 13.27px / 10px | 18.96px / 13.29px | `#108b8b` |
| Error message copy | Nunito | Regular | 14px | 20.58px | error-toned (mixed fill; verify vs. screenshot), desktop only |
| Field label | Nunito | SemiBold | 14px / 12px | 18.96px / 13.29px | `#153d3a` |
| Field placeholder | Nunito | Regular | 14px / 10–12px | 18.96px / 13.29px | `#b0aba1` |
| Helper text (phone) | Nunito | Regular | 12px / 10px | 14.98px / 10.5px | `#a0a89e` |
| Button label | Nunito | Bold | 15.32px / 14px | 22.98px / 16.1px | `#ffffff` |
| Trust row text | Nunito | Regular | 12px / 10px | 14.98px / 10.5px | `#a0a89e` |
| "Already registered?" | Nunito | Regular | 14px / 12px | 18.96px / 16.72px | `#7a8a80` |
| "Login" link | Nunito | SemiBold | 14px / 12px | 18.96px / 16.72px | `#108b8b` |

## Component measurements

- **Input fields**: height ~48px (desktop) / ~33.6px (mobile); cornerRadius 10.21px (desktop) / 7.16px (mobile); border 1px `#d6d2c8`; fill `#ffffff`.
- **Phone field country chip**: dark `#153d3a` fill, fused to left edge of the input, contains "+91" (Nunito Bold) + chevron-down icon (`#ffffff`).
- **Primary button**: fully rounded pill (cornerRadius raw 1020.13 desktop / 714.97 mobile); padding 16.34/32.68px (desktop), 11.45/22.9px (mobile); gradient fill assumed same "Gredient 2" as login (not explicitly present in this node's raw style dump — verify against screenshot).
- **Error box** (desktop only): cornerRadius 10.21px, fill `#fff5f5`, padding ~14.3px.
- **Form card**: cornerRadius 20.42px (desktop) / 14.31px (mobile), fill `#ffffff`.

## Figma node IDs

- Desktop top-level frame: `2430:1278` ("MacBook Pro 14\" - 21")
- Mobile top-level frame: `2569:6419` ("iPhone 16 & 17 Pro - 2")

## Behavioral / annotation notes

- This is the "Invitation Only" / phone-gated signup flow: users must have a pre-registered phone number;
  the error state ("This phone number is not on the access list. Please contact your admin.") is shown
  when validation fails — currently only modeled in the desktop frame's Figma layers.
- The desktop primary CTA button's raw fill data wasn't returned by `get_node` for this specific button
  layer (cornerRadius/padding came through fine) — cross-check the screenshot to confirm it's the same
  "Gredient 2" gradient used elsewhere before hardcoding.
