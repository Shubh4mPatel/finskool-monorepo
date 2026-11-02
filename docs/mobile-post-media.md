# Post media: ratio and orientation (mobile)

Posts can carry images, uploaded videos and YouTube / Instagram links. The backend now reads the real size of every
uploaded image and video and returns it, so the app can lay a post out before the media loads.

The files are stored exactly as the admin uploaded them: nothing is cropped or re-encoded. The app decides how to fit them.

## What changed in the post responses

These fields are added to every post object (`GET /mobile/posts`, `GET /posts/my-comments`, and the admin post endpoints).
Existing fields (`imageUrls`, `videos`) are unchanged.

| Field | Type | Meaning |
|---|---|---|
| `ratio` | number or null | The post's media ratio, `width / height` (1.7778 for 16:9, 0.8 for 4:5, 0.5625 for 9:16). |
| `orientation` | `"portrait"`, `"landscape"` or null | `portrait` when taller than wide. A square is `landscape`. |
| `mediaWidth`, `mediaHeight` | integer or null | The pixel size `ratio` comes from. |
| `images` | array | Every image with `url`, `width`, `height`, `ratio`, `orientation`, in display order. |
| `videos[].width`, `height`, `ratio`, `durationSec` | number or null | For uploaded video files. |

`ratio` / `orientation` / `mediaWidth` / `mediaHeight` come from the post's **first sized item**: the first image, or if
there are no images, the first uploaded video. Every item also has its own size, so a post that mixes portrait and
landscape media can still be laid out item by item.

Use `images` instead of `imageUrls` when you need sizes (`imageUrls` is the same URLs, without them).

## When the values are null

- **Links.** YouTube and Instagram links are stored as pasted. Their size is not known, so `videos[].width/height/ratio`
  is null. A post with only links has `ratio: null`: pick your own default (16:9 for YouTube, 4:5 for Instagram works well).
- **Posts without media.** All null.
- **Old posts.** Posts saved before this change have no sizes (`ratio: null`, and `images[].width` null) until an admin
  next saves them, which fills the sizes in. Treat null as "unknown" and fall back to your default layout.

## Videos

An uploaded video also gets a poster frame: `videos[].thumbnailUrl` (a JPEG next to the video file). Old uploaded videos
have no poster, so `thumbnailUrl` can be null for `kind: "file"`.

## How the admin side works (for reference)

The admin page uploads files to `POST /api/v1/posts/media` (multipart, field `files`, up to 10 files). Images (JPG, PNG,
WebP, GIF, up to 10 MB) and videos (MP4, MOV, up to 50 MB) are checked by their content. The response gives each file's
width, height, ratio and orientation. When the post is saved, the server reads the sizes again from the stored files and
ignores any size sent by the client.
