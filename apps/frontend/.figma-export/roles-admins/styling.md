# Roles & Admins (Team & Role Management)

Super-admin-only page for managing admin team accounts and their community access levels.
**Desktop-only** — no mobile frame exists for this screen.

## Screenshots in this folder

| File | Source node |
|---|---|
| `desktop.png` | `2555:116327` ("-60") |
| `modal-delete-admin.png` | `2555:115843` ("-62") — see Annotations re: backdrop mismatch |

## Frame dimensions

- `desktop.png`: **1478 × 997**
- `modal-delete-admin.png` (whole frame): **1490 × 982**
- Search/filter bar: 985×69 @ (322,162)
- Admin table card: 1136×359 @ (306,279), r16
- Delete Admin modal: 400×298 @ (545,342)

## Layout structure

- Header: "Team & Role Management" (Nunito Bold 22px `#153d3a`) + "Manage admin accounts and their
  access levels. Super Admin access only." subtitle + small teal eyebrow "Admin Panel" label + "Add New
  Admin" pill button (top right, dark fill, white text + plus icon).
- Search/filter bar (`Background+Shadow`, 985×69, r12, padding 14/18): "Search by name or email…" input
  (`Background+Border`, fill `#fafaf8`, r10, stroke `#d6d2c8`) + "All Communities" dropdown
  (`Background+Border`, white bg, r10, stroke `#d6d2c8`, text color **`#4a5a50`** — flagged, new muted
  color for dropdown text specifically here).
- **Admin table** (`Background+Shadow`, 1136×359, r16): header row fill `#f5f3ed`, columns ADMIN / EMAIL
  / COMMUNITY ACCESS / LAST ACTIVE / ACTIONS (Poppins Bold 11px, letter-spacing 0.44px, color `#a0a89e`).
  Rows alternate `#ffffff`/`#fafaf8`, stroke `#f0ede8`, row height 63–64px. Per row:
  - Avatar-initials circle (36×36, fully rounded) — color-coded per admin (not a single fixed color):
    `#153d3a` bg / `#c1f26e` initials (Hardik), `#108b8b` bg / white initials (RS), `#edfad4` bg /
    `#153d3a` initials (PR), `#fff3e0` bg / `#d97706` initials (AS), `#ede9fe` bg / `#7c3aed` initials
    (SS) — five distinct avatar color pairings, likely auto-generated per-user rather than by role.
  - Name (Nunito Bold 13px `#153d3a`) + optional "You" badge (pill, fill `#e0f4f4`, text `#108b8b`,
    Nunito Bold 9px) next to the current user's own row.
  - Email (Nunito Regular 13px `#a0a89e`).
  - Community access pill: "Both Communities" (fill `#153d3a`, white text) / "Swing Alpha" (fill
    `#edfad4`, text `#153d3a`) / "Investor" (fill `#e0f4f4`, text `#108b8b`) — Nunito Bold 11px.
  - Last-active timestamp (Nunito Regular 13px `#a0a89e`, e.g. "Just now" / "2 hours ago" / "Yesterday" /
    "3 days ago" / "1 week ago").
  - Row actions: edit icon-button (pill, stroke `#153d3a`) + delete icon-button (pill, fill `#dc26261a`,
    trash icon `#dc2626`).
- **"Delete Admin?" confirm modal** (`Background+Shadow`, 400×298, r16, padding 32/28/28/32) — same
  visual spec as the other confirm-dialogs documented in `confirm-dialog-component/styling.md`: icon
  circle 52×52 (fill `#dc26261a`), heading "Delete Admin?" (Poppins Bold 16px `#dc2626`), body text
  "This will remove their admin access immediately. Their account will revert to regular member status.
  This action can be undone by re-inviting them." (Nunito Regular 13px, lh 22.75, color `#a0a89e`),
  "Cancel" pill (white, stroke `#153d3a`) + "Yes, Delete" pill (fill `#dc2626`, white text).

## Colors used on this screen (raw hex)

Baseline palette applies (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#d6d2c8`, `#a0a89e`,
`#f0ede8`, `#dc2626`, `#dc26261a`).

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#4a5a50` | "All Communities" dropdown text color (distinct muted tone) |
| `#e0f4f4` / `#108b8b` | "You" badge and "Investor" community-access pill |
| `#edfad4` / `#153d3a` | "Swing Alpha" community-access pill |
| `#fff3e0` / `#d97706` | One admin's avatar color pairing (amber) — not tied to any status meaning here, purely a per-user avatar color |
| `#ede9fe` / `#7c3aed` | Another admin's avatar color pairing (purple) — **new hue not seen anywhere else in the file**, flagged as a one-off |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading | Nunito | Bold | 22px |
| Eyebrow label | Nunito | SemiBold | 11px |
| Table header cells | Poppins | Bold | 11px (letter-spacing 0.44px) |
| Admin name | Nunito | Bold | 13px |
| Email / last-active | Nunito | Regular | 13px |
| Community-access pill | Nunito | Bold | 11px |
| "You" badge | Nunito | Bold | 9px |
| Search/dropdown text | Nunito | Regular | 13px |
| Modal heading | Poppins | Bold | 16px |
| Modal body | Nunito | Regular | 13px (lh 22.75) |
| Modal buttons | Nunito | Bold | 13px |

## Component measurements

- **Table row**: 63–64px tall, alternating `#ffffff`/`#fafaf8`, stroke `#f0ede8`.
- **Avatar circle**: 36×36, fully rounded.
- **Community/status pill**: ~21px tall, r999, padding 3/10.
- **Row action icon button**: 33×23, r50, padding 5/10.
- **Search input / dropdown**: 41px tall, r10, stroke `#d6d2c8`, padding 10/14.
- **Delete Admin modal**: 400×298, r16 — same dimensions/spec family as other confirm-dialogs (see
  `confirm-dialog-component/styling.md`).

## Figma node IDs used

- Main page: `2555:116327`
- Delete Admin modal frame: `2555:115843` (dialog card `2555:116310`)

## Annotations / notes

- **Backdrop mismatch**: `modal-delete-admin.png`'s frame (`2555:115843`) is blurred/dimmed behind the
  modal, and that background is confirmed (via its own "Member Management" text) to be the **Members**
  table, not the Roles & Admins table shown in `desktop.png`. This is almost certainly another instance
  of the same reusable confirm-dialog component being prototyped on a convenient copy of an existing
  frame rather than on its actual host page — see `confirm-dialog-component/styling.md` and
  `members/styling.md` for the other instances of this pattern.
- **Backend cross-reference**: no backend routes currently exist in this repo for admin role/team
  management (searched for admin-role/team endpoints — none found in `admin.routes.ts` or elsewhere).
  This should be flagged as a **new feature to build** — user list with roles, community-access scoping,
  invite/delete admin, and audit fields (last active) all appear to need new API surface.
