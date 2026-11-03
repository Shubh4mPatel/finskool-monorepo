# Showing post images and videos without breaking the layout (mobile)

Companion to `mobile-post-media.md`, which lists the fields. This page says **what to do with them**.

## The problem

The server stores every image and video exactly as the admin uploaded it. It never crops or resizes. A feed can therefore contain a 4:5 portrait photo, a 16:9 video and a square chart, and a post can mix them. If the app simply lets each image take its own height, posts jump around, the list scrolls unevenly, and a 9:16 clip can fill the whole screen.

## The rule

> **Every post gets one fixed frame. Every image and video of that post is fitted inside that frame.**

1. The frame's ratio comes from the post, not from the file that is currently loading: `post.ratio` (width / height).
2. The frame's size is known before anything downloads, so the feed does not jump while images load.
3. All items of a post (carousel pages, video poster) use the same frame, so they look the same.
4. Files that do not match the frame are fitted (see "Fitting"), never stretched.

The admin screen already tells admins to use one ratio for all files of a post (for example 4:5 or 16:9), so most posts need no fitting at all. The rule above is what keeps the app safe when they do not.

## 1. Choose the frame ratio

```dart
const minRatio = 0.8;     // 4:5, the tallest frame allowed
const maxRatio = 1.91;    // about 1.91:1, the widest frame allowed
const defaultRatio = 16 / 9;

double frameRatio(Post p) {
  final r = p.ratio;                       // null when unknown (see the table below)
  if (r == null) return defaultRatio;
  return r.clamp(minRatio, maxRatio).toDouble();
}
```

Why clamp: a 9:16 reel (0.5625) as a full-width frame would be taller than the phone screen. Clamped to 4:5 it stays a normal feed card, and the full-screen viewer (section 5) shows the whole thing.

`post.ratio` is the **first image**, or if the post has no images, the **first uploaded video**. `post.orientation` (`portrait` or `landscape`; a square counts as landscape) is the same thing in words. Use `ratio` for layout and `orientation` only for choices like "show the fullscreen button".

## 2. The values you will actually receive

Real responses from `GET /api/v1/mobile/posts` (trimmed):

```json
{ "title": "Market outlook", "ratio": 0.8, "orientation": "portrait", "mediaWidth": 1080, "mediaHeight": 1350,
  "images": [
    { "url": "https://…/a.jpg", "width": 1080, "height": 1350, "ratio": 0.8, "orientation": "portrait" },
    { "url": "https://…/b.jpg", "width": 1080, "height": 1080, "ratio": 1,   "orientation": "landscape" } ],
  "videos": [] }

{ "title": "Webinar", "ratio": 1.7778, "orientation": "landscape",
  "images": [],
  "videos": [ { "kind": "file", "url": "https://…/v.mp4", "thumbnailUrl": "https://…/v.jpg",
                "width": 1920, "height": 1080, "ratio": 1.7778, "durationSec": 42, "embedUrl": null } ] }

{ "title": "Link only", "ratio": null, "orientation": null,
  "images": [],
  "videos": [ { "kind": "youtube", "url": "https://youtu.be/…", "embedUrl": "https://www.youtube-nocookie.com/embed/…",
                "width": null, "height": null, "ratio": null, "thumbnailUrl": null } ] }
```

The first post is the example of why the frame matters: its second image is square, but the post's frame stays 4:5.

## 3. What to do when a value is null

| Situation | What you get | What to do |
|---|---|---|
| Post with no media | `ratio: null`, `images: []`, `videos: []` | No media block at all. |
| Only YouTube / Instagram links | `ratio: null`, `videos[].ratio: null` | Frame 16:9 for YouTube, 4:5 for Instagram. |
| Post saved before sizes existed | `ratio: null`, `images[].width: null` | Frame 16:9 (`defaultRatio`). It is fixed the next time an admin saves the post. |
| Uploaded video from before posters existed | `kind: "file"`, `thumbnailUrl: null` | Show a dark placeholder with a play icon in the frame. |
| One image of a mixed post has no size | `images[i].ratio: null` | Fit it like any other file; the frame does not need its size. |

Never divide by `width` or `height` without a null check, and never crash on `ratio: null`.

## 4. Fitting a file into the frame

Compare the file's own ratio (`item.ratio`) with the frame's:

```dart
Widget fitted(double frame, double? itemRatio, Widget media, {String? blurUrl}) {
  final close = itemRatio != null && (itemRatio - frame).abs() / frame < 0.15;
  if (itemRatio == null || close) {
    // Same shape (or unknown): fill the frame. At most a thin strip is trimmed.
    return FittedBox(fit: BoxFit.cover, clipBehavior: Clip.hardEdge, child: media);
  }
  // Different shape: show all of it, never crop a chart or a face.
  return Stack(fit: StackFit.expand, children: [
    if (blurUrl != null) ImageFiltered(imageFilter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Image.network(blurUrl, fit: BoxFit.cover)),
    Center(child: FittedBox(fit: BoxFit.contain, child: media)),
  ]);
}
```

Rule of thumb: within about 15% of the frame's ratio -> **cover** (fills, trims a sliver). Further away -> **contain** on a blurred or dark background (shows everything, no empty white bars). Never `BoxFit.fill`.

Build the frame itself with `AspectRatio`, so it has its height from the first frame of the screen:

```dart
AspectRatio(
  aspectRatio: frameRatio(post),
  child: ClipRRect(borderRadius: BorderRadius.circular(12), child: carouselOrSingle(post)),
)
```

## 5. Multiple media in one post

- **Order:** `images` first, in the given order, then `videos`, in the given order.
- **One item:** just the frame.
- **Several items:** a horizontal pager (`PageView`) **inside the same frame**, with dots or a "1/3" counter. The frame height never changes while swiping. This is the single most important thing for a stable feed.
- **Tap an image:** open a full-screen viewer with pinch-to-zoom (`InteractiveViewer`). Here use `BoxFit.contain` and the file's real shape, with no clamping, so a 9:16 file is seen whole. This is where portrait reels and tall charts are shown at full size.

## 6. Videos

- **Uploaded file (`kind: "file"`)**: show `thumbnailUrl` in the frame with a play button and the length (`durationSec`, for example 0:42). Start playing only on tap (and never auto-play with sound). Playing in the feed keeps the frame; play full screen on a second tap for portrait clips.
- **YouTube (`kind: "youtube"`)**: use `embedUrl` in a web view / player, in a 16:9 frame. There is no `thumbnailUrl`; YouTube's own player shows its poster.
- **Instagram (`kind: "instagram"`)**: use `embedUrl` in a web view in a 4:5 frame; give the web view a fixed height so it cannot resize the list.
- The video's `ratio` already accounts for phone rotation (a clip stored sideways with a rotation tag is reported as portrait), so use it as given.

## 7. Before the image has loaded

Because `ratio` is known up front:

- draw the frame immediately with a light grey (or shimmer) background and the correct aspect ratio;
- fade the image in when it arrives (`FadeInImage` / `Image.network` with `frameBuilder`);
- on an error show the same frame with a small "could not load" icon and a retry tap.

Use `cacheWidth` (about the frame width in physical pixels) when decoding, so big photos (up to 10 MB) do not fill memory.

## 8. Checklist for the mobile developer

- [ ] Frame built with `AspectRatio(frameRatio(post))` for every post that has media.
- [ ] `ratio` clamped to 0.8 to 1.91; `null` falls back to 16:9 (4:5 for Instagram-only).
- [ ] No image or video ever sized from its own pixels inside the feed.
- [ ] Mixed-ratio posts use cover when close, contain on a blurred background when not.
- [ ] Several items sit in one pager inside one frame; the height never changes while swiping.
- [ ] Tap opens a full-screen, zoomable, uncropped viewer.
- [ ] Uploaded videos show `thumbnailUrl`, play on tap; `thumbnailUrl: null` has a placeholder.
- [ ] All `null` cases from section 3 tested (use the demo seed's posts, or an old post).
- [ ] Tested with a 9:16 clip, a very wide banner, a square image and a post with three mixed items.

## For reference: what the admin side does

The admin upload (`POST /api/v1/posts/media`) measures every file from its content (EXIF-corrected for photos, rotation-corrected for videos), so the sizes you receive are what a person sees. The server never crops, so **the layout rules above are the only thing that keeps mixed posts tidy on the phone.**
