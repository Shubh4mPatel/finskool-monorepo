export type PostVideoKind = "file" | "youtube" | "instagram";

// Mirrors PostVideoDTO from the backend (apps/backend/src/modules/posts/posts.dto.ts).
// `id` is absent on videos that haven't been saved yet.
export interface PostVideo {
  id?: string;
  kind: PostVideoKind;
  url: string;
  embedUrl: string | null;
  externalId?: string | null;
  title: string | null;
  thumbnailUrl: string | null;
}

export const MAX_POST_VIDEOS = 3;
// Matches MAX_VIDEO_BYTES on the backend and the 50 MB body limits on both nginx hops.
export const MAX_VIDEO_MB = 50;
export const VIDEO_TYPES_BY_EXT: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime" };

/** What the create/update post APIs expect — the server re-derives everything else. */
export function toVideoInput(v: PostVideo): { kind: PostVideoKind; url: string; title?: string } {
  return { kind: v.kind, url: v.url, ...(v.title ? { title: v.title } : {}) };
}
