# Admin Profile

The admin's own profile page: basic information (phone/email), community-access tags, and account
actions (edit details / change password). **Desktop-only** — no mobile frame exists for this screen.

## Screenshots in this folder

| File | Source node |
|---|---|
| `desktop.png` | `2555:113078` ("-117") |

## Frame dimensions

1512 × 994 (standard admin canvas size).

- Profile card: 981×342 @ (318,150), r20
- Cover banner strip (top of card): 981×64, rounded top corners only
- Avatar: 68×68
- Bottom action bar strip: 981×82, rounded bottom corners only

## Layout structure

- Sidebar: standard spec. Note: the "Dashboard" nav link renders in its **active** (filled `#153d3a`)
  state even though this is the Profile page — likely a design oversight rather than intentional
  (there's no dedicated "Admin Profile" sidebar entry; the page is reached via the top-right avatar/
  profile icon instead, so no sidebar item should really be "active" here).
- Breadcrumb: "Dashboard" (Nunito SemiBold 11px `#108b8b`) `>` "Admin Profile" (Nunito ExtraBold 11px
  `#108b8b`).
- Page heading: "Basic Information" (Nunito Bold 20px `#153d3a`).
- **Profile card** (981×342, r20, white bg):
  - Cover banner: solid `#153d3a` strip, 981×64, rounded top corners only.
  - Avatar: 68×68 circle with border, overlaid with a small camera-icon button (fill `#108b8b`,
    fully rounded) for changing the photo — positioned bottom-right of the avatar, overlapping the banner/content boundary.
  - Name "Ritesh Kumar" (Nunito Bold 18px `#153d3a`) + small "Edit" pill next to it (fill `#153d3a33` —
    20%-alpha dark teal, Poppins Regular 10px text, edit-pencil icon) — an inline rename affordance.
  - "Super Admin" role badge (pill, fill `#c1f26e`, text `#153d3a` Bold ~11.5px).
  - Community-access tags: "Swing Alpha" (pill, fill `#c1f26e1a`, stroke `#c1f26e`, Nunito Regular 10px)
    and "Investor" (pill, fill `#108b8b1a`, stroke `#108b8b`, chart icon, Nunito Regular 10px) — same
    community-tag visual language used across other admin screens.
  - Divider rule (`#ede9e2`).
  - **Field: Phone Number** — label (Nunito SemiBold 13px `#153d3a`) + read-only value box showing
    "+919898989890" (Nunito Regular 13px, color **`#000000`** raw black — flagged, inconsistent with
    the rest of the file which typically uses `#153d3a` for value/body text) in a box with fill
    **`#f8f7f5`** (new near-white warm gray, flagged), r10, stroke `#d6d2c8`.
  - **Field: E mail Address** — same layout/style, value "ritesh@example.com".
  - Bottom action strip (fill `#f8f7f5`, rounded bottom corners only): "Edit Details" pill button
    (fillStyle **"Gredient 2"** confirmed directly on the node, white text + pencil icon) and "Change
    Password" pill button (white/transparent bg, stroke `#108b8b`, text `#108b8b`, lock icon).

## Colors used on this screen (raw hex)

Baseline palette applies (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`, `#ffffff`, `#d6d2c8`, `#a0a89e`,
`#ede9e2`), plus "Gredient 2" on the primary "Edit Details" button.

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#f8f7f5` | Read-only field value background, and the bottom action-bar strip background — a new near-white warm gray not seen elsewhere |
| `#000000` | Raw black on field values (phone/email) — flagged as inconsistent with the rest of the file's `#153d3a` body-text convention |
| `#153d3a33` | 20%-alpha dark teal — inline "Edit" pill background next to the name |
| `#c1f26e1a` / `#108b8b1a` | Community tag pill backgrounds (Swing Alpha / Investor) — consistent with other screens |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading | Nunito | Bold | 20px |
| Breadcrumb | Nunito | SemiBold/ExtraBold | 11px |
| Profile name | Nunito | Bold | 18px |
| "Super Admin" badge | Nunito | Bold | ~11.5px |
| Community tag | Nunito | Regular | 10px |
| Field label | Nunito | SemiBold | 13px |
| Field value | Nunito | Regular | 13px |
| Inline "Edit" pill | Poppins | Regular | 10px |
| Action buttons | Nunito | SemiBold | 13px |

## Component measurements

- **Profile card**: 981×342, r20.
- **Cover banner**: 981×64, rounded top corners only, fill `#153d3a`.
- **Avatar**: 68×68, fully rounded, with a small ~18×18 camera-icon button overlaid.
- **Field value box**: 450×44, r10, stroke `#d6d2c8`, padding ~12/14/11/14.
- **Action-bar strip**: 981×82, rounded bottom corners only, fill `#f8f7f5`.
- **Action buttons**: ~39px tall, r999 (pill), padding 9/18.

## Figma node IDs used

- Frame: `2555:113078`

## Annotations / notes

- Sidebar "Dashboard" link shows the active/highlighted style on this page despite there being no
  dedicated sidebar entry for "Admin Profile" — flagged as a likely design inconsistency (no functional
  impact assumed, but worth confirming intended nav-highlight behavior when implementing).
- A stray, out-of-frame vector node (`2555:114040`, positioned far outside the 1512-wide canvas at
  x≈2183) exists in the raw Figma data but is not visually part of this screen — an artifact, not content.
