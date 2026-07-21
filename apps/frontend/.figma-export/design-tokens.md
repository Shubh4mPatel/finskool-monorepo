# Shared Design Tokens — Finskool CRM (Copy)

Raw values only (no Tailwind token mapping), extracted from the Figma file `VlrQiMVJrufb7odvfObH5F`
("Finskool CRM (Copy)"), page "Main". These recur across both the User Dashboard and Admin Dashboard
screen exports in this folder — each screen's own `styling.md` cross-checks against this baseline and
flags anything screen-specific or new.

## Colors (raw hex)

| Hex | Role |
|---|---|
| `#153d3a` | Primary dark teal/green — dark panel backgrounds, heading text on light backgrounds |
| `#108b8b` | Teal accent — links, badges, secondary button text/border |
| `#c1f26e` | Lime green accent — decorative icons, gradient start |
| `#85cd78` | Green accent — highlights one word in headings (e.g. "Community"), success accents |
| `#f5f3ed` | Page/canvas background (warm off-white) |
| `#ffffff` | Card and input background, button text on dark/gradient buttons |
| `#d6d2c8` | Input field border |
| `#b0aba1` | Input placeholder text |
| `#a0a89e` | Muted secondary text, icon strokes |
| `#7a8a80` / `#5a8a80` | Muted teal-gray text variants |
| `#ede9e2` | Divider lines |
| `#e05050` | Error/destructive icon color |
| `#fff5f5` | Error message background |

**Gradient "Gredient 2"** — the file's only named/shared paint style (confirmed via `get_styles`):
linear gradient from `#c1f26e` to `#108b8b`, used on primary pill CTA buttons (e.g. "Login to
Community", "Create My Account").

## Typography

- **Poppins** (Bold/SemiBold/Medium/Regular) — headings and display text. Sizes vary widely by
  context: hero headings run 24–68px depending on desktop vs. mobile and page importance.
- **Nunito** (Regular/SemiBold/Bold/Medium/ExtraBold/Italic) — body text, form labels, buttons, most
  UI copy. Roughly 9–20px depending on context.
- **Inter** (Regular/Medium/"Semi Bold"/Bold) — appears mixed into several later-iteration screens
  (some mobile feed variants, and admin modal titles like "Add Member" / "Extend Subscription" /
  "Add Reason for Suspension"). This is very likely an unintentional font drift from a later design
  pass rather than a deliberate second typeface — flagged per-screen where it shows up.
- File-wide usage (`get_fonts`): Nunito Regular/Bold/SemiBold dominate; Poppins Regular/Bold/Medium/
  SemiBold next most common; Inter Medium/Semi Bold/Regular/Bold is a smaller but real chunk.

## Corner radius

- **Cards** ("Background+Shadow" containers): ~20–21px on desktop frames, ~17–18px on mobile frames.
- **Input fields** ("Background+Border" containers): ~10–11px desktop, ~8–9px mobile.
- **Primary buttons**: raw cornerRadius values are huge (800–1070+) — this just means "fully
  pill-rounded" (radius ≥ half the button height). Record as "fully rounded / pill", not the literal
  number.
- **Small tag/badge chips**: also fully rounded.

## Notes

- This file was reconstructed after the fact — the original export pass reported writing it but the
  file was never actually persisted to disk. Content matches what both export passes (User Dashboard
  and Admin Dashboard) were seeded with and cross-referenced against, so downstream `styling.md` files
  remain consistent with this baseline.
- Admin-specific additions on top of this baseline (status pill colors, table stripe colors, modal
  overlay tints, etc.) are documented per-screen in the admin folders rather than promoted here, since
  several of them were flagged as one-off/inconsistent rather than deliberate shared tokens.
