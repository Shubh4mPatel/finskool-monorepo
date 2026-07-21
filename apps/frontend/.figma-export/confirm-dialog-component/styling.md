# Confirm Dialog (shared component) — design-system note

Not a page — this documents the shared visual spec of the reusable confirm-dialog pattern that appears
identically (structurally) across ~7 different places in the Admin Dashboard Figma cluster:
`modal-delete-user.png` / `modal-revoke-suspension.png` / `modal-confirm-mark-all-read.png` /
`modal-delete-thread.png` (all in `members/`), `modal-delete-admin.png` (in `roles-admins/`), and — with
a slightly different but related spec — the "Add Reason for Suspension" (`members/`) and
"Extend Subscription" (`admin-dashboard/`, `members/`) modals. Representative example pulled via
`get_node` on **`2553:88386`** ("Delete User?" modal, frame `-98`; dialog card `2553:88855`).

No dedicated screenshot was exported for this note (per the task) — see the screenshots already
captured in `members/modal-delete-user.png` etc. for visual reference.

## Frame dimensions (representative: "Delete User?")

- Dialog card: **400 × 275** (400×267 for the shortest-body variant, "Confirm Action"; 400×298 for the
  longest-body variant, "Delete Admin?") — height flexes with body-copy length, width is fixed at 400.
- Icon circle: 52×52
- Buttons: Cancel 86.53×41, confirm action button 88–115×41 (width flexes with label length)

## Visual spec (raw values)

- **Overlay/backdrop**: full-viewport semi-transparent dimmer, raw fill `#d9d9d933` (~20% opacity gray)
  observed on the admin-dashboard "Extend Subscription" modal's backdrop rectangle, combined with a
  visually heavy background blur (confirmed in the rendered screenshot; the Figma MCP tool does not
  expose blur-radius as a raw value for this node — no `effects` data was returned at all).
- **Card**: 400px wide, corner radius **16**, fill `#ffffff`, padding **32 top / 28 left / 28 right / 32
  bottom**, centered on screen.
- **Icon circle**: 52×52, fully rounded (r999), background = the accent color at **20% alpha**:
  - Destructive (delete): fill `#dc26261a`, icon stroke/fill `#dc2626` (alert-triangle-style icon, ~21.68×19.52)
  - Positive (revoke/undo): fill `#4caf501a`, icon `#4caf50` (user-tick icon)
- **Heading**: Poppins Bold **16px**, line-height 24, color matches the accent (`#dc2626` for
  destructive, `#4caf50` for positive). Text is the dialog's title, e.g. "Delete User?", "Revoke
  Suspension?", "Confirm Action", "Delete Thread?", "Delete Admin?".
- **Body text**: Nunito Regular **13px**, line-height ~22.75 (a "mixed" text-run style was reported by
  the Figma tool for some instances — likely multiple sub-runs with identical visual styling), color
  `#a0a89e` (lighter gray) on some instances / `#000000` (raw black) on others — **flagged
  inconsistency**: body-text color is not consistent across all instances of this "same" component (the
  Delete Admin variant uses `#a0a89e`, the Delete User/Delete Thread/Confirm Action variants use
  `#000000`). This should be standardized when implementing.
- **Cancel button**: pill (r999), white fill, stroke `#153d3a` (or `#e5e0d8` on the "Add Reason"/"Extend
  Subscription" family — a second, slightly different secondary-button stroke color also appears in the
  file), text Nunito Bold 13px `#153d3a`, padding 10/22.
- **Confirm/action button**: pill (r999), solid accent fill (`#dc2626` red for destructive actions,
  `#4caf50` green for positive/undo actions), white Nunito Bold 13px text, padding 11/22.

## Colors (raw hex, all instances observed)

| Hex | Usage |
|---|---|
| `#dc2626` | Destructive heading/icon/button (Delete User, Delete Thread, Confirm Action, Delete Admin) |
| `#dc26261a` | Destructive icon-circle background (20% alpha) |
| `#4caf50` | Positive/undo heading/icon/button (Revoke Suspension) |
| `#4caf501a` | Positive icon-circle background (20% alpha) |
| `#ffffff` | Card background, button text on filled buttons |
| `#153d3a` | Cancel button text/border (primary variant) |
| `#e5e0d8` | Cancel button border (secondary variant, seen on Extend Subscription/Add Reason family) |
| `#a0a89e` / `#000000` | Body text color — **inconsistent across instances**, flagged above |
| `#d9d9d933` | Full-screen backdrop dimmer |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Dialog heading | Poppins | Bold | 16px (lh 24) |
| Dialog body | Nunito | Regular | 13px (lh ≈22.75) |
| Button text | Nunito | Bold | 13px |

## Component measurements

- Card: 400px wide (height 267–298 depending on body length), r16, padding 32/28/28/32.
- Icon circle: 52×52, r999.
- Cancel button: 86.53×41, r999, padding 10/22.
- Confirm button: 88–115×41 (width fits content), r999, padding 11/22.
- Gap between Cancel and confirm buttons: 12px.

## Figma node IDs used

- Representative example: `2553:88386` (frame), dialog card `2553:88855`
- Other instances referenced: `2553:88872` (Revoke Suspension), `2553:95231` (Confirm Action),
  `2553:94730` (Delete Thread), `2555:115843` (Delete Admin)

## Comparison against the existing codebase component

The repo already has `apps/frontend/src/components/ui/ConfirmDialog.tsx` (a context/provider-based
`useConfirm()` hook rendering a single, hardcoded-red confirm dialog). Comparing it against the Figma
spec above:

| Aspect | Code (`ConfirmDialog.tsx`) | Figma spec | Match? |
|---|---|---|---|
| Backdrop | `bg-black/20` + `backdrop-blur-sm`, fixed inset-0 | `#d9d9d933` (~20% gray) + heavy blur | **Close match** — both are a ~20%-opacity dark overlay with blur |
| Card | `rounded-2xl` (16px), `bg-white`, `p-6` (24px), `max-w-sm` (384px), `shadow-card-hover` | r16, white, padding 28–32px, fixed 400px wide | Corner radius matches exactly; code's padding (24px all sides) and width (384px) are close but not identical to Figma's (28–32px asymmetric padding, fixed 400px) |
| Icon | `h-14 w-14` (56×56) `rounded-full bg-red-50 text-red-500`, `AlertTriangle` 26px | 52×52, r999, `#dc26261a` bg, `#dc2626` icon ~21.7×19.5 | Very close — code is red-only; Figma has a **second green variant** (Revoke Suspension) with no code equivalent |
| Heading | `font-display text-lg font-bold text-red-500` | Poppins Bold 16px, color matches accent | Close (`text-lg` is commonly 18px vs Figma's 16px) — code is always red, no accent-color switching |
| Body | `text-sm leading-relaxed text-muted` | Nunito Regular 13px, lh ≈22.75 | Close in spirit; exact size/line-height depend on the project's Tailwind config for `text-muted`/`leading-relaxed` |
| Cancel button | `rounded-full border border-divider px-5 py-2.5 text-sm font-semibold text-primary` | pill, stroke `#153d3a` or `#e5e0d8`, Bold 13px | Matches shape/role; exact border/text color depends on `divider`/`primary` token values |
| Confirm button | `rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white shadow-glow` | pill, fill `#dc2626` or `#4caf50`, white Bold 13px | Matches for the red/destructive case; **no green/positive variant exists in code** |
| Default title | `"Confirm Action"` | Matches the Figma "Confirm Action" instance's literal title exactly | Exact match — confirms this generic default is the intended reusable fallback |

**Key gap to flag**: the Figma file clearly designs **two color variants** of this dialog — red/destructive
(Delete User, Delete Thread, Confirm Action, Delete Admin) and green/positive (Revoke Suspension) — but
the current code component only implements the red variant (hardcoded `bg-red-500`/`text-red-500`/
`bg-red-50`). If the Revoke Suspension action (or any other "positive/undo" confirm action) is to be
implemented, `ConfirmDialog.tsx`/`useConfirm()` would need a `variant`/`tone` prop (e.g. `"destructive" |
"positive"`) to switch between the red and green treatments, rather than being permanently red.

## Annotations / notes

- This confirms the design-system intent: all ~7 confirm-dialog instances across the Admin Dashboard
  cluster are the same component with different copy/props, not separately designed modals — see the
  per-screen notes in `members/styling.md` and `roles-admins/styling.md` for the specific instances and
  their (sometimes mismatched) backdrops.
- Body-text color inconsistency (`#a0a89e` vs `#000000` across instances) and secondary-button border
  color inconsistency (`#153d3a` vs `#e5e0d8`) both look like drift between design passes rather than
  intentional variation — worth picking one value each when finalizing the component's design tokens.
