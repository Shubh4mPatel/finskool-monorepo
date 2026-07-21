# Stock Tracker — Active Recommendations

"Active Recommendations" screen: a data table (desktop) / card list (mobile) of admin stock calls
(Company/Sector/Rec Date/Entry/CMP/Target/Stop Loss/Return %/Risk/Call type BUY-SELL-HOLD), plus 4 stat
tiles (Total Calls, Active, Avg Return, Win Rate).

**This feature does not exist yet in the backend** — there is no stock/recommendation Prisma model or API
route in this repo (`d:\amarr\server`) at the time of this export. This is a **new feature to build**, not
a redesign of an existing page; there's no existing implementation to cross-reference.

## Frame dimensions

- Desktop: **1512 x 942** px ("MacBook Pro 14\" - 64")
- Mobile: **402 x 1573** px ("iPhone 16 & 17 Pro - 8")

## Layout structure

### Desktop (1512x942)
- **Left nav sidebar**: identical pattern to other screens (Background+Shadow, 16px radius). "Recommendations"
  is the active item here (dark `#153d3a` pill), alongside Announcements/Stock Tracker/My Threads/Feed as
  inactive items — note the sidebar's item order/labels on this screen differ slightly from `live-feed/`
  (includes a "Stock Tracker" entry not present in the other screens' sidebar dump), so the nav item set
  may vary per screen; treat the full nav item list as: Feed, Announcements, Stock Tracker, Recommendations
  (active), My Threads, Logout.
- **Header row** (`x:330 y:47`): H1 "Active Recommendations" (Poppins Bold **22px**, `#153d3a`), subtext
  "Stock calls from your admin. Updated in real-time." (Nunito Regular 14px, `#000000`), filter buttons
  "Calls"/"Sector"/"Date" (dark `#153d3a` pills, Nunito SemiBold 11px `#ffffff`, dropdown/calendar icons,
  cornerRadius fully rounded, padding 6/19px), and a live-status dot ("Last updated: 2 min ago", dot fill
  `#4caf50`, text Nunito Regular 11px `#153d3a`).
- **Stat tile row** (`x:330 y:141.7`, 4 tiles, each `w:267 h:70.7`): "Background+Shadow", cornerRadius
  **10px**, fill `#ffffff`, padding 14/16px.
  - "Total Calls" / "Active": icon (stroke `#153d3a`) + label Nunito Regular 12px `#153d3a` (value number
    itself not present in this dump — likely a dynamic count rendered above the label; check screenshot).
  - "Avg Return": value "+18.4%" Nunito Bold **20px**, color `#7ab82e` (a new olive-green, distinct from
    the shared palette) + label "Avg Return" Nunito Regular 12px `#153d3a`.
  - "Win Rate": value "76%" Nunito Bold 20px `#153d3a` + label "Win Rate" Nunito Regular 12px `#153d3a`.
- **Table card** (`x:330 y:232`, "Background+Shadow", `w:1116 h:521.8`): cornerRadius **16px**, fill `#ffffff`.
  - Table header row: "All Calls" (Poppins SemiBold 16px `#153d3a`) + a search input ("Search stocks…",
    bordered, fill `#fafaf8`, border `#d6d2c8`, cornerRadius 10px, placeholder Nunito Regular 13px `#b0aba1`).
  - **Column header row** (fill `#f5f3ed`, h:35): column labels COMPANY / REC. DATE / ENTRY ₹ / CMP ₹ /
    TARGET ₹ / STOP LOSS ₹ / RETURN % / RISK / CALL — all Poppins SemiBold **11px**, letter-spacing 0.44px,
    `#153d3a`, uppercase.
  - **Data rows** (h:61.2, alternating fill `#ffffff` / `#fafaf8`, border-bottom `#f0ede8`):
    - Company cell: small logo placeholder square (32x32, cornerRadius 8px, border `#153d3a` — or no
      border on alternating rows, verify) + company name (Nunito Bold 13px `#153d3a`) + sector chip below
      (cornerRadius 4px — square-ish, not pill, fill unspecified/transparent, text Nunito Regular 11px `#7a8a80`).
    - Rec Date: Nunito Regular 13px `#7a8a80`.
    - Entry ₹: Nunito Regular 13px `#4a5a50` (a distinct muted-green token from other screens' `#5a6a60`).
    - CMP ₹: Nunito Bold 13px `#153d3a`.
    - Target ₹ / Stop Loss ₹: Nunito Regular 13px `#7a8a80`.
    - Return %: Nunito Bold 13px, color `#0b9e7a` for positive values (e.g. "+13.4%", "+21.6%", "+53.2%",
      "+21.0%") — a new teal-green, distinct from the shared `#2d6a1a`/`#4caf50` greens used elsewhere.
    - Risk badge (pill, cornerRadius 999): **Low** = bg `#edfad4`, dot `#4caf50`, text `#2d6a1a`, Nunito
      SemiBold 11px; **Medium** = bg `#fff3e0`, dot `#e8a020`, text `#9a5f00`; **High** = bg `#fff0f0`, dot
      `#d93030`, text `#b02020`.
    - Call-type badge (pill, cornerRadius 999, solid fill, white/colored bold 11px text): **BUY** = fill
      `#4caf50`, text `#ffffff`; **HOLD** = fill `#ffa300`, text `#ffffff`; **SELL** = fill `#fdecea`
      (light, unlike BUY/HOLD's solid fill), text `#c0282a` — note SELL uses a light-bg/dark-text pattern
      while BUY/HOLD use solid-bg/white-text; verify this asymmetry is intentional before implementing.
  - **Pagination footer** (`x:0 y:463.8`, border-top `#ede9e2`): "Showing 6 of 14 recommendations" (Nunito
    Regular 11px `#a0a89e`) + page buttons — **cornerRadius 6px** (squared, unlike the pill buttons used
    everywhere else in this file), active page fill `#153d3a`/text `#ffffff`, inactive fill `#ffffff`/
    border `#d6d2c8`/text `#7a8a80`; "Previous"/"Next" text buttons same style.
  - A closing italic disclaimer line below the table (`#b0aba1`, Nunito Italic 11px) — get the exact
    copy from the screenshot if needed (text was cut off in this data pull).

### Mobile (402x1573)
Structurally different from desktop — **cards instead of a table**:
- Top bar: search input (Inter placeholder, same Inter/Nunito mismatch as other mobile screens), "Swing
  Alpha" chip, logout button — matches other mobile screens' top bar.
- Heading "Active Recommendations" (Poppins Bold 22px `#153d3a`) + subtext (Nunito Regular 14px `#000000`)
  + filter pills (Calls/Sector/Date, same dark pill style as desktop) + live-status dot row.
- Stat tiles: same 4 tiles (Total Calls, Active, Avg Return "+18.4%" in `#7ab82e`, Win Rate "76%"), stacked
  2x2, `Background+Shadow`, cornerRadius 10px.
- "All Calls" section label: **Inter** Bold **18px** `#153d3a` — note this is Inter, not the Poppins used
  for the equivalent desktop label ("All Calls" is Poppins SemiBold 16px on desktop) — another instance of
  the file-wide Inter/Nunito/Poppins mismatch, this time affecting a heading rather than body text.
- **Stock cards** (`Rectangle 42063`, `w:374 h:145`): cornerRadius **8px**, fill `#ffffff`, border `#ececec`
  (a new border token, distinct from the shared `#d6d2c8`/`#ede9e2`).
  - Logo placeholder square (35x35, cornerRadius ~5.16px, border `#153d3a`).
  - Company name: Nunito Medium/Bold **14px** `#153d3a` (weight varies by row — "Adani Power" is Medium,
    "Infosys"/"TATA Motors" are Bold; likely inconsistent, verify per-row).
  - Sector + date row: plain text "Energy" / "12 May 2026" separated by a small dot (`#6f6f6f` — new muted
    gray), Nunito Medium 12px `#7a8a80` — **different visual pattern from desktop**, which uses a colored
    sector chip instead of inline plain text.
  - Column labels (Entry ₹ / CMP ₹ / Target ₹ / Return% / Stop Loss ₹): **Inter** "Semi Bold" 12px `#153d3a`.
  - Column values (₹2,450 / ₹2,750 / ₹3,899 / ₹2,899): **Inter** Regular 12px `#6f6f6f`.
  - Divider line `#d9d9d9` between the label/value block and the metadata row.
  - Return % value: **green** `#30bd05` for positive ("+13.4%"), **red** `#dc2626` for negative ("-9.6%")
    — **a different green/red pair from desktop's `#0b9e7a`/(risk-badge reds)** — flag as a real
    inconsistency between desktop and mobile return-value coloring, not just a design nuance.
  - Risk badge (mobile): **Low** = bg `#30bd051a` (10%-alpha green), dot+text `#30bd05`; **High** = bg
    `#dc26261a` (10%-alpha red), dot+text `#dc2626` — this is a **completely different color system** from
    desktop's Low/Medium/High badges (`#edfad4`/`#fff3e0`/`#fff0f0` bg with `#2d6a1a`/`#9a5f00`/`#b02020`
    text) — desktop and mobile do not share risk-badge colors; pick one system or intentionally reconcile
    before implementing.
  - Call-type badge: **BUY** = fill `#4caf50`, text `#ffffff`, cornerRadius fully rounded — consistent with
    desktop's BUY styling.
- **Bottom tab bar**: Feed / Announcement / Recommendation (active here, filled `#108b8b` circle icon +
  `#108b8b` label + solid `#108b8b` count badge "5" with white text) / My Threads.

## Colors used on this screen

Shared tokens: `#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#7a8a80`, `#a0a89e`, `#b0aba1`,
`#d6d2c8`, `#ede9e2`, `#4caf50`.

Screen-specific (desktop): `#7ab82e` (Avg Return figure), `#4a5a50` (Entry ₹ text), `#0b9e7a` (positive
Return % text), `#edfad4`/`#2d6a1a` (Risk: Low), `#fff3e0`/`#e8a020`/`#9a5f00` (Risk: Medium),
`#fff0f0`/`#d93030`/`#b02020` (Risk: High), `#ffa300` (Call: HOLD), `#fdecea`/`#c0282a` (Call: SELL),
`#fafaf8` (search input fill), `#f0ede8` (row border).

Screen-specific (mobile, largely **different** from desktop's equivalents): `#ececec` (card border),
`#6f6f6f` (column values / sector-dot), `#30bd05`/`#30bd051a` (positive return / Risk: Low — desktop uses
`#0b9e7a`/`#edfad4` instead), `#dc2626`/`#dc26261a` (negative return / Risk: High — desktop uses
`#d93030`/`#fff0f0` instead), `#d9d9d9` (card internal divider).

## Typography table

| Role | Font | Weight | Size | Color |
|---|---|---|---|---|
| Page heading | Poppins | Bold | 22px | `#153d3a` |
| Page subtext | Nunito | Regular | 14px | `#000000` |
| Filter pill label | Nunito | SemiBold | 11px | `#ffffff` |
| Stat tile value | Nunito | Bold | 20px | `#7ab82e` (Avg Return) / `#153d3a` (Win Rate) |
| Stat tile label | Nunito | Regular | 12px | `#153d3a` |
| Table section label ("All Calls") | Poppins (desktop) / **Inter** (mobile) | SemiBold / Bold | 16px / 18px | `#153d3a` |
| Column header (desktop) | Poppins | SemiBold | 11px | `#153d3a` |
| Column label (mobile card) | **Inter** "Semi Bold" | 600 | 12px | `#153d3a` |
| Company name | Nunito | Bold (desktop) / Medium-Bold (mobile, inconsistent) | 13-14px | `#153d3a` |
| Sector chip / text | Nunito | Regular / Medium | 11-12px | `#7a8a80` |
| Cell value (generic) | Nunito (desktop) / **Inter** (mobile) | Regular | 12-13px | `#7a8a80` / `#6f6f6f` |
| Risk/Call badge text | Nunito | SemiBold/Bold | 11-12px | varies (see Colors) |
| Pagination text | Nunito | SemiBold | 11px | `#7a8a80` / `#ffffff` (active) |

## Component measurements

- **Stat tile**: cornerRadius 10px, fill `#ffffff`, padding 14/16px, drop shadow implied by layer name.
- **Table card**: cornerRadius 16px, fill `#ffffff`.
- **Table row**: height 61.2px, border-bottom 1px `#f0ede8`.
- **Company logo placeholder**: 32x32 (desktop) / 35x35 (mobile), cornerRadius 8px / ~5.16px, border `#153d3a` on some rows.
- **Risk/Call badges**: fully rounded pill, small dot (6-7px) + label, padding ~5/14px.
- **Pagination buttons**: cornerRadius **6px** (squared — the one place in this file pill buttons are NOT fully rounded).
- **Mobile stock card**: cornerRadius 8px, fill `#ffffff`, border 1px `#ececec`, internal divider `#d9d9d9`.

## Figma node IDs

- Desktop top-level frame: `2592:35695` ("MacBook Pro 14\" - 64")
- Mobile top-level frame: `2650:6639` ("iPhone 16 & 17 Pro - 8")

## Notes

- **New feature**: no backend model/endpoint exists for stock recommendations in this repo — plan schema,
  API, and admin-entry flow alongside the frontend build.
- Desktop and mobile use **materially different color systems** for the Risk badge and Return % text —
  this isn't just a stylistic mobile adaptation, it's two different palettes. Decide on one canonical set
  before implementation (recommend reconciling toward the desktop set, matching the shared `#0b9e7a`-style
  greens and `#d93030`-style reds already used for market widgets elsewhere in the file).
- SELL call-type badge uses light-bg/dark-text while BUY/HOLD use solid-bg/white-text — verify intent.
- Mobile "All Calls" label and cell values use Inter while desktop uses Poppins/Nunito — consistent with
  the file-wide Inter/Nunito mismatch flagged in `design-tokens.md`.
