# Import CSV (3-step wizard)

Admin flow for bulk-importing/updating members via CSV upload. **Desktop-only** — no mobile frame
exists for this screen.

## Screenshots in this folder

| File | Source node | Step |
|---|---|---|
| `step-1-upload.png` | `2553:89868` ("-101") | Upload File |
| `step-2-preview.png` | `2553:90045` ("-102") | Preview & Review |
| `step-3-success.png` | `2553:91017` ("-105") | Import Successful (result screen) |

## Frame dimensions

- Step 1: **1512 × 1162** (taller than the standard 994 admin canvas — this page has more vertical content)
- Step 2: **1512 × 989**
- Step 3: **1512 × 989**
- Step-1 dropzone card: 1072×404 @ (317,227); dropzone itself ~1020×224
- Step-1 "CSV Format Guide" card: 1087×242 @ (317,653)
- Step-2 preview table card: 1087×567 @ (317,225)
- Step-3 content: centered result block around (511–1024, 260–460)

## Layout structure

**Shared**: standard sidebar; header "Import Members" (step 1: Nunito Bold 22px; step 3: **Poppins
SemiBold 22px** — a font-family swap between steps, flagged) + "Upload a CSV file to add or update
members in bulk" subtitle + teal eyebrow "Import CSV" label; 3-step indicator (same visual spec as
`create-post`'s: circle 32×32 r999, connector line 2px, label below) advancing per step.

**Step 1 — Upload File** (card `2553:89962`, 1072×404, r16, padding 32/26/24/26):
- "Upload CSV File" heading (Nunito Bold 16px) + "Download Sample CSV" pill link (white bg, r999,
  stroke `#108b8b`, download icon, Nunito SemiBold 13px teal text).
- Dropzone (`Background+Border`, ~1020×224, r14, fill `#f5f3ed`, stroke `#153d3a` — rendered as a
  **dashed** border in the screenshot, though the Figma MCP data doesn't expose a dash-pattern
  property): cloud-upload icon, "Drag and drop your CSV file here" (Nunito Bold 16px `#153d3a`), "or"
  (Nunito Regular 13px `#a0a89e`), "Browse File" pill button (r999, **Gredient 2** fill confirmed
  visually — lime→teal — white bold text + folder icon), caption ".CSV files only · Max 10MB" (Nunito
  Regular 11px `#b0aba1`).
- "Upload & Preview →" full-width-ish pill button (r999, **Gredient 2** fill, white Nunito Bold 13px text).
- **"CSV Format Guide" card** (`2553:89996`, 1087×242, r16, padding 24/26/32/26): heading "CSV Format
  Guide" (Nunito Bold 16px) followed by a compact reference table showing the expected columns (SR. NO,
  NAME, PHONE NUMBER, PAYMENT, PAID ON, VALID, COMMUNITY, EMAIL — Poppins Bold 11px, letter-spacing
  0.44px, header row fill `#f5f3ed`) with **one example data row** ("1 / Sandeep / 9898090907 / 4000 /
  15 Aug 2026 / 15 Aug 2026 / Swing Alpha (pill, fill `#edfad4`) / ram@12example.com") on a `#fafafa`
  striped row — this is a format reference, not a live preview.

**Step 2 — Preview & Review** (card `2553:90168`, 1087×567, r16, padding 24/26/32/26) — this is the
node the original task brief expected to find at a different ID (`2553:89372`); see Annotations:
- Heading "Sample CSV Preview" (Nunito Bold 16px).
- Data table: columns Sr. no / NAME / Phone number / Payment / paid on / valid / Community / Email,
  6 sample rows, alternating row backgrounds `#fafafa`/`#fafaf8`, community tag pills (`#edfad4` "Swing
  Alpha" / `#108b8b1a` "Investor").
- Bottom action bar: "Cancel" pill (white, stroke `#e5e0d8`) + "Confirm Import" pill (fillStyle
  **"Gredient 2"**, confirmed directly on this node) — these are the step's primary action buttons, not
  a separate overlaid modal (see Annotations — the task brief anticipated a distinct "confirm modal"
  state here, but no such second state exists in the file).

**Step 3 — Import Successful** (result screen, centered content block):
- Large circular success badge (~67×64 rounded shape, fill **`#47a400`** — a new bright green, distinct
  from `#4caf50` used in the Members confirm-dialogs — flagged) with a white checkmark.
- "Import Successful" heading (Poppins Bold 22px, color `#47a400`).
- Summary line "248 new members added · 12 updated · 2 rows skipped" (Nunito Regular ~18.47px, lh
  26.39, color **`#4a6a40`** — another new muted-green variant, flagged).
- "Back To List →" link (Nunito SemiBold 13px `#108b8b`).

## Colors used on this screen (raw hex)

Baseline palette from `design-tokens.md` applies (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`,
`#a0a89e`, `#b0aba1`, `#ede9e2`), plus "Gredient 2" on primary CTA buttons.

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#47a400` | Step-3 success icon + "Import Successful" heading — bright green, not elsewhere in the file |
| `#4a6a40` | Step-3 summary text — muted olive-green, distinct from `#47a400` and from `#4caf50` used in Members' Revoke confirm-dialog |
| `#c0c8c0` | Step-indicator inactive-circle stroke (steps 2/3 pending state) — same color flagged in `create-post` |
| `#edfad4` / `#108b8b1a` | Community tag pill backgrounds (Swing Alpha / Investor) — consistent with `members`/`all-posts` |
| `#d6d2c8` | Step-indicator connector line (upcoming, pre-`-105` iteration) |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading (step 1) | Nunito | Bold | 22px |
| Page heading (step 3) | **Poppins** | **SemiBold** | **22px** (font swap vs. step 1 — flagged) |
| Eyebrow label | Nunito | ExtraBold/Bold | 11px |
| Step-indicator number/label | Nunito | Bold/Regular | 13px |
| Dropzone heading | Nunito | Bold | 16px |
| Dropzone caption | Nunito | Regular | 11px |
| Browse/Upload button text | Nunito | Bold | 13px |
| CSV Format Guide header cells | Poppins | Bold | 11px (letter-spacing 0.44px) |
| Table cell text | Nunito | Regular/Bold | 13px |
| Success heading | Poppins | Bold | 22px |
| Success summary line | Nunito | Regular | ~18.47px (lh 26.39) |
| "Back To List" link | Nunito | SemiBold | 13px |

## Component measurements

- **Dropzone**: ~1020×224, r14, dashed stroke `#153d3a`, fill `#f5f3ed`.
- **CSV Format Guide table row**: header row fill `#f5f3ed`, data row fill `#fafafa`.
- **Preview table** (step 2): alternating `#fafafa`/`#fafaf8` rows, same column-header style as
  `members`' table (Poppins Bold 11px).
- **Success icon**: ~67×64, solid fill, white checkmark centered.
- **Buttons**: pill (r999), Gredient2 fill for primary actions, white/`#e5e0d8`-stroke for secondary.

## Figma node IDs used

- Step 1 (Upload File): `2553:89868`
- Step 2 (Preview & Review): `2553:90045`
- Step 3 (Import Successful): `2553:91017`

## Annotations / notes

- **Node-ID correction (important)**: the task brief for this pass specified `step-2-preview.png` from
  node `2553:89372` ("-100") and a separate `step-2-confirm-modal.png` from `2553:90045` ("-102"). On
  inspection:
  - `2553:89372` ("-100") does **not** contain any CSV content at all — it's actually a near-duplicate
    of the Members table with an "Add Reason for Suspension" modal overlaid (documented instead in
    `members/styling.md` as `modal-suspend-reason.png`).
  - `2553:90045` ("-102") **is** the real "Sample CSV Preview" screen (confirmed via its own "Sample CSV
    Preview" heading text) — and it does **not** contain a separate overlaid confirm-modal state. Its
    "Cancel"/"Confirm Import" buttons are simply the step's normal action bar, not a modal dialog.
  - Net effect: this folder only has 3 screenshots (upload / preview / success), not 4 — there is no
    genuine "confirm modal" state to capture separately from the preview step.
- **Backend cross-reference**: maps to `POST /api/v1/admin/import-csv` and
  `POST /api/v1/admin/validate-import` in `admin.routes.ts`/`admin.service.ts` — step 1 corresponds to
  file upload/validation, step 2 to the parsed preview, step 3 to the import result summary
  (added/updated/skipped counts).
- Multiple distinct greens appear across this one flow for "success"/positive states (`#47a400`,
  `#4a6a40`, plus the shared `#c1f26e`/`#85cd78` from the base palette) — worth consolidating to a
  single success color if/when this flow is implemented in code.
