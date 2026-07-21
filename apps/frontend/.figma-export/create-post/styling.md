# Create Post (3-step wizard)

Admin flow for publishing a post to a community: pick community → write content → review & publish.
**Desktop-only** — no mobile frame exists for this screen.

## Screenshots in this folder

| File | Source node | Step |
|---|---|---|
| `step-1-community-type.png` | `2553:91140` ("-106") | Community selection |
| `step-2-write-content.png` | `2553:91552` ("-108") | Headline / description / tags / image |
| `step-3-review-publish.png` | `2553:91772` ("-109") | Preview + Publish |

## Frame dimensions

All three steps: **1512 × 994** (same admin canvas size as `admin-dashboard`).

- Step indicator bar: 820×90.66 @ (330,141.66), card r14
- Step 1 content card: 820×424 @ (330,256), r16
- Step 2 content card: 595×633 @ (414,283), r16
- Step 3 post-preview card: 567×652 @ (472,253); inner preview panel 595×… (Background+Shadow r16)

## Layout structure

**Shared across all 3 steps**: standard admin sidebar (269×940, r16); header "Create New Post" (Nunito
Bold 22px `#153d3a`) + "Follow the steps to publish a post to your community" subtitle (Nunito Regular
13px) + small teal eyebrow label "Create Post" (Nunito ExtraBold 11px `#108b8b`); a horizontal 3-step
indicator card (numbered circles 32×32 r999 + label below, connected by 2px divider lines) that
advances per step:
- Step 1: circle 1 filled `#153d3a`/white number (active), circles 2–3 white w/ `#d6d2c8` stroke and
  muted `#b0aba1` text, connector lines `#e5e0d8` (unfilled/upcoming style — flagged, `design-tokens.md`
  doesn't list `#e5e0d8` as a connector color but it recurs here consistently for "not yet reached").
- Step 2: circles 1–2 filled `#153d3a` (both done/active), circle 3 still white/`#d6d2c8`/muted.
- Step 3: all 3 circles filled `#153d3a`, all connector lines filled `#153d3a` (fully progressed).

**Step 1 — Community & Type** (card `2553:91266`, 820×424, r16, padding 32/32/28/32):
- Heading "Which community is this post for?" (Nunito Bold 16px `#153d3a`) + subtitle "Members of the
  other community will not see this post" (Nunito Regular 13px `#a0a89e`).
- Two selectable community cards (370×289 each, side by side):
  - **Swing Alpha** (selected state): `Background+Border+Shadow`, r16, fill `#ffffff`, stroke `#153d3a`
    (dark border = selected), padding 24. Banner rectangle (370×151, top of card). Heading "Swing Alpha"
    (Nunito Bold 16px), description (Nunito Regular 11px, lh 17.6), member-count pill "312 members"
    (fill `#edfad4`, text `#153d3a`, Nunito Bold 10px).
  - **Investor Community** (unselected state): `Background+Border`, r16, fill `#fafaf8` (not white),
    stroke `#e5e0d8` (light, not `#153d3a`) — this is how the unselected state is visually distinguished
    from the selected one. Member-count pill "248 members" (fill `#e0f4f4`, text `#108b8b`).
  - Divider rule (`#ede9e2`) beneath both cards.

**Step 2 — Write Content** (card `2553:91681`, 595×633, r16, padding 24/24/0/24):
- Headline input: single-line box (547×43, r8, stroke `#dedede`, white bg); placeholder "Add a headline
  e.g. TATASTEEL breakout confirmed, target ₹175" — Nunito Regular 14px, color `#c0c8c0` (placeholder gray).
- Description textarea: box (547×195, r8, stroke `#dedede`, white bg) with an internal formatting
  toolbar strip (519×42, r10, fill `#f8f8f6`) holding 5 toolbar buttons (30×30, r6); placeholder "Add
  Description e.g. Tip: Include entry price, target, stop loss and reasoning for stock calls." — Nunito
  Regular 14px, lh 23, color `#c0c8c0`.
- Tags row: label "Add tags" (Nunito Regular 12px), input box (547×38.66, r8, stroke `#dedede`)
  pre-populated with 3 removable tag chips — `#RELIANCE`, `#BUY`, `#SWING` (each: pill, fill `#f1efe8`,
  r999, Nunito Bold 11px text, "×" remove glyph) — plus placeholder text "#RELIANCE, #BUY, #SWING…"
  (Nunito Regular 11px).
- "Add Image" control: small button (90×34, r5, stroke `#dedede`) with an image icon + "Add Image"
  label (Nunito Regular 12px) — a compact button, not a full drag-and-drop dropzone (contrast with
  `import-csv`'s upload step which does use a large dropzone).
- Bottom action bar (`HorizontalBorder`, top border `#ebebeb`, padding 16 top/bottom): "Cancel" pill
  (192×43, r50, white, stroke `#e5e0d8`, Poppins Medium 14px `#153d3a`) + "Continue to review" pill
  (192×43, r50, fill not captured as a raw hex by the MCP tool — inferred to be the shared **"Gredient
  2"** style based on visual/pattern consistency with the equivalent CTA buttons on steps 1→2 and the
  step-3 "Publish" button, both of which do expose `fillStyle: "Gredient 2"` explicitly).

**Step 3 — Review & Publish** (outer card `2553:91908`, r16, padding ~41/28/32/28):
- "← Back to Step 2" link (Nunito SemiBold 13px `#a0a89e`).
- Post preview panel: badge "Post preview" (pill, fill `#c1f26e`, eye icon + Nunito Bold ~12.9px
  `#153d3a` text) sits above a preview card (`Background+Border+Shadow`, r14, fill `#ffffff`, stroke
  `#e8e8e8`, padding 27/20/18/20):
  - Author row: avatar circle + "Ritesh Kumar" (Nunito Bold 13px), community tag "Swing Alpha" (pill,
    fill `#c1f26e1a`, stroke `#c1f26e`, Nunito Regular 10px).
  - Post title "RELIANCE — Breakout swing setup. Target ₹1,575" (Nunito Bold 15px `#153d3a`).
  - Body text (Nunito Regular 13px, lh 22.75, color **`#5f5e5a`** — a muted brownish-gray not in the
    shared palette).
  - Image placeholder block (480×240, r10).
  - Hashtag chips `#RELIANCE` `#BUY` `#SWING` (pill, fill `#f1efe8`, Nunito Bold 11px, color `#5f5e5a`).
- Bottom action bar (top border `#ebebeb`): "Cancel" pill (white, stroke `#e5e0d8`) + "Publish" pill
  (fillStyle **"Gredient 2"** confirmed directly on this node, white text + arrow icon).

## Colors used on this screen (raw hex)

Baseline palette from `design-tokens.md` applies throughout (`#153d3a`, `#108b8b`, `#c1f26e`, `#f5f3ed`,
`#ffffff`, `#d6d2c8`, `#b0aba1`, `#a0a89e`, `#ede9e2`), plus the "Gredient 2" gradient on primary CTAs.

**New / screen-specific colors — flagged:**

| Hex | Usage |
|---|---|
| `#dedede` | Input border stroke on headline/description/tags fields (step 2) and image-add button — distinct from the standard `#d6d2c8` input border used elsewhere in the file |
| `#c0c8c0` | Placeholder text color in step 2's headline/description inputs — distinct from the standard `#b0aba1` placeholder gray used elsewhere |
| `#f1efe8` | Tag-chip pill background (`#RELIANCE`/`#BUY`/`#SWING`) |
| `#f8f8f6` | Rich-text toolbar strip background inside the description field |
| `#5f5e5a` | Muted body-text color in the step-3 post preview (post description, hashtag text) |
| `#e8e8e8` | Post-preview card border stroke (step 3) |
| `#ebebeb` | Bottom action-bar top divider (steps 2 and 3) |
| `#e5e0d8` | Unselected/upcoming step-indicator connector line; Cancel-button border |
| `#c1f26e1a` | 20%-alpha tint of `#c1f26e` — "Swing Alpha" community tag background (step 3 preview) |
| `#888780` | Muted icon stroke variant seen in step 2 (close to but distinct from `#7a8a80`/`#a0a89e`) |
| `#1a1a1a` | One-off near-black text occurrence in step 2, negligible |
| `#edfad4` / `#e0f4f4` | Member-count pill backgrounds on the step-1 community cards (Swing Alpha / Investor respectively) — consistent with `members/styling.md`'s community-tag colors |

## Typography

| Role | Family | Weight | Size |
|---|---|---|---|
| Page heading | Nunito | Bold | 22px |
| Eyebrow label ("Create Post") | Nunito | ExtraBold | 11px |
| Step-indicator number | Nunito | Bold | 11px |
| Step-indicator label | Nunito (Poppins for step 1/3 labels) | Regular/Medium | 11px |
| Step-1 card heading | Nunito | Bold | 16px |
| Step-1 card subtitle | Nunito | Regular | 13px |
| Community card name | Nunito | Bold | 16px |
| Community card description | Nunito | Regular | 11px (lh 17.6) |
| Member-count pill text | Nunito | Bold | 10px |
| Headline input (placeholder) | Nunito | Regular | 14px (lh 27) |
| Description input (placeholder) | Nunito | Regular | 14px (lh 23) |
| Tags label | Nunito | Regular | 12px |
| Tag chip text | Nunito | Bold | 11px |
| Add Image label | Nunito | Regular | 12px |
| Post-preview author name | Nunito | Bold | 13px |
| Post-preview title | Nunito | Bold | 15px |
| Post-preview body | Nunito | Regular | 13px (lh 22.75) |
| Post-preview badge | Nunito | Bold | ~12.9px |
| Cancel / primary CTA buttons | Poppins | Medium | 14px |

## Component measurements

- **Step indicator**: circle 32×32 (r999), connector line 2px tall, label 11px below circle.
- **Community selector card**: 370×289, r16, padding 24; banner 370×151 at top.
- **Headline / tag input**: ~43px tall single line, r8, stroke `#dedede`, padding 8/12.
- **Description textarea**: 547×195, r8, stroke `#dedede`; internal toolbar strip 519×42, r10.
- **Add Image button**: 90×34, r5, stroke `#dedede`.
- **Post-preview card** (step 3): r14, stroke `#e8e8e8`, padding 27/20/18/20; image block 480×240 r10.
- **Primary/secondary buttons**: 192×43 (step 2) / 158×43 (step 3), pill (r50).

## Figma node IDs used

- Step 1 (Community & Type): `2553:91140`
- Step 2 (Write Content): `2553:91552`
- Step 3 (Review & Publish): `2553:91772`

## Annotations / notes

- **Backend cross-reference**: this wizard maps to `POST /api/v1/posts` (admin-only) in
  `posts.routes.ts`/`posts.controller.ts` — the community selector corresponds to the post's community
  scope, the write-content step to title/body/tags/image fields, and the review step to a client-side
  preview before the actual create call.
- Step 2's "Continue to review" button doesn't expose its fill as a raw hex via the Figma MCP tool
  (only fills captured elsewhere expose `fillStyle: "Gredient 2"` directly) — treated as the same shared
  gradient CTA style based on strong visual/structural consistency with sibling buttons on this same flow.
- Multiple near-duplicate muted grays appear across this one flow (`#a0a89e`, `#b0aba1`, `#c0c8c0`,
  `#888780`, `#5f5e5a`) for what is functionally the same "secondary/placeholder text" role — likely
  incidental drift between design passes rather than a deliberate multi-tier gray scale; worth
  consolidating if/when this flow is implemented in code.
