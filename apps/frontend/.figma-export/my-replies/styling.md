# My Replies / My Threads — Threads I've Commented On

"My Threads" page: lists posts the user has commented on, shown as expandable threads. Visually and
structurally this Figma screen **reuses the exact same layout as `live-feed-thread-expanded/`** (same
TATASTEEL post + expanded comment thread + composer, same second HDFCBANK post card below) — the only
differences are the page heading/active-nav state and a couple of small comment-thread details. Read
`live-feed-thread-expanded/styling.md` first for the full shared-component spec (sidebar, search bar,
filter pills, post card, admin-reply treatment, composer); this document only calls out what's different.

**Cross-reference**: this corresponds to the already-implemented `/replies` page in this repo —
`apps/frontend/src/app/(dashboard)/replies/page.tsx` — and its backend endpoint `GET
/api/v1/posts/my-comments`. Use the existing implementation as a functional reference (data shape, routing)
while restyling to match this Figma spec.

## Frame dimensions

- Desktop: **1512 x 1549** px ("MacBook Pro 14\" - 73") — identical to `live-feed-thread-expanded/`.
- Mobile: **402 x 1805** px ("iPhone 16 & 17 Pro - 13") — taller than `live-feed-thread-expanded/`'s
  1902px mobile capture is *shorter* here (1805 vs 1902); minor content-length difference, not a layout change.

## What's different from `live-feed-thread-expanded/`

### Desktop
- **Page heading**: "My Threads" (Poppins SemiBold 20px, `#153d3a`) instead of "Live Feed".
- **Active nav item**: "My Threads" is the highlighted sidebar pill (dark `#153d3a` fill, white text/icon)
  instead of "Recommendations"/"Announcements" being active on other screens. Full nav set observed:
  Feed, Announcements, Recommendations, **My Threads (active)**, Logout.
- **Comment avatars**: the current user's own comments show initial **"Y"** (for "You") instead of the
  generic "M1"/"M2"/"M3" member initials seen in `live-feed-thread-expanded/`. Two different avatar color
  pairs were observed for "Y" across the two comment instances on this screen — bg `#e8f5ec`/text
  `#108b8b` in one place and bg `#e0f4f4`/text `#2d5e5a` or `#108b8b` in another — treat as inconsistent
  and pick one pairing rather than replicating both.
- **"Reply" action includes a count**: this screen shows **"Reply (1)"** (Nunito SemiBold ~10.36px,
  `#108b8b`) on the user's own comment rows, vs. plain "Reply" (no count) in `live-feed-thread-expanded/`.
  This makes sense for a "my threads" context (showing how many replies each of your comments has
  received) — implement the count as data-driven, not hardcoded.
- All other elements (admin reply box with `#85cd78` accent, composer, "Threads (12)" header, second post
  card below the thread, "Swing Alpha" chip, Market Today / Community Rules widgets) are pixel-identical
  to `live-feed-thread-expanded/` — see that file for full measurements.

### Mobile
- **Page heading**: "My Threads" (Poppins Bold **22px**, `#153d3a`) instead of "Live feed".
- **Bottom tab bar**: "My Threads" tab is active (filled `#108b8b` circle icon, label Inter Medium 11px
  `#108b8b`) instead of "Feed" or "Announcement".
- Post card, thread list, composer, and all typography/color details otherwise match
  `live-feed-thread-expanded/`'s mobile spec exactly (same Inter/Poppins font mismatch on the post
  heading/body, same `#b6e54d` card border, same `#143f3d`/`#888880` text colors).

## Figma node IDs

- Desktop top-level frame: `2650:7765` ("MacBook Pro 14\" - 73")
- Mobile top-level frame: `2650:8271` ("iPhone 16 & 17 Pro - 13")

## Notes

- Treat this screen as a **thin variant** of `live-feed-thread-expanded/` — reuse the same components,
  swap the page heading/active-nav state, and make the "Reply (n)" count and comment-author label ("You"
  vs. a member name) data-driven based on whether the viewing user authored the parent comment.
- No new colors/fonts beyond what's already catalogued in `live-feed-thread-expanded/styling.md` and
  `design-tokens.md`.
