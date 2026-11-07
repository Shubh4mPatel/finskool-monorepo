export const MAX_POST_VIDEOS = 3

export type PostVideoKind = 'file' | 'youtube' | 'instagram'

/** What the admin UI sends. Everything else (ID, embed URL, thumbnail) is derived server-side. */
export interface PostVideoInput {
  kind: PostVideoKind
  url: string
  title?: string | undefined
}

export interface PostVideoDTO {
  id: string
  kind: PostVideoKind
  url: string
  /** Iframe src for youtube/instagram; null for an uploaded file (play `url` in a <video>). */
  embedUrl: string | null
  externalId: string | null
  title: string | null
  thumbnailUrl: string | null
  /** Size of an uploaded file, read from the file itself. Null for YouTube/Instagram links (size unknown) and for files saved before sizes were stored. */
  width: number | null
  height: number | null
  /** width / height, e.g. 1.7778 for 16:9, 0.5625 for 9:16. */
  ratio: number | null
  durationSec: number | null
}

export type MediaOrientation = 'portrait' | 'landscape'

export interface PostImageDTO {
  url: string
  /** Null only for images of posts saved before sizes were stored and not yet re-saved. */
  width: number | null
  height: number | null
  ratio: number | null
  orientation: MediaOrientation | null
}

/**
 * The shape of a post's media for the app to lay it out. Taken from the first sized item (images first, then
 * uploaded videos); null when the post has no sized media (no media, only YouTube/Instagram links, or an old post).
 * The files themselves are stored as uploaded, never cropped.
 */
export interface PostMediaShapeDTO {
  images: PostImageDTO[]
  mediaWidth: number | null
  mediaHeight: number | null
  ratio: number | null
  orientation: MediaOrientation | null
}

export interface CreatePostDTO {
  communityId: string
  title: string
  content: string
  tags: string[]
  imageUrls: string[]
  videos: PostVideoInput[]
  /** Shared by every copy created in one publish — see Post.publishGroupId. */
  groupId?: string | undefined
}

export interface UpdatePostDTO {
  title?: string | undefined
  content?: string | undefined
  tags?: string[] | undefined
  imageUrls?: string[] | undefined
  videos?: PostVideoInput[] | undefined
}

export interface PostResponseDTO extends PostMediaShapeDTO {
  id: string
  communityId: string
  authorId: string
  title: string
  content: string
  imageUrls: string[]
  videos: PostVideoDTO[]
  tags: string[]
  status: string
  pinOrder: number | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PostFeedItemDTO extends PostMediaShapeDTO {
  id: string
  communityId: string
  communityName: string
  communitySlug: string
  communityBadgeUrl: string | null
  authorName: string
  authorAvatarUrl: string | null
  title: string
  content: string
  imageUrls: string[]
  videos: PostVideoDTO[]
  tags: string[]
  pinOrder: number | null
  publishedAt: Date | null
  createdAt: Date
  commentCount: number
  reactionCounts: Record<string, number>
  myReaction: string | null
  /** Admin list only: reactions summed over this post's publish group (just its own for a standalone post). */
  groupReactionCounts?: Record<string, number> | undefined
  /** Admin list only: how many posts that sum covers. */
  groupSize?: number | undefined
}

export interface ListPostsResponseDTO {
  posts: PostFeedItemDTO[]
  pageSize: number
  /** Pass as `cursor` to get the posts after these; null when there are none. Present in both paging modes. */
  nextCursor: string | null
  // Absent when paging by `cursor` — the count is skipped then (the first page already gave it).
  total?: number
  page?: number
  totalPages?: number
}

export interface CommentedPostItemDTO extends PostMediaShapeDTO {
  id: string
  communityId: string
  communityName: string
  communitySlug: string
  communityBadgeUrl: string | null
  authorName: string
  authorAvatarUrl: string | null
  title: string
  content: string
  imageUrls: string[]
  videos: PostVideoDTO[]
  tags: string[]
  pinOrder: number | null
  publishedAt: Date | null
  createdAt: Date
  commentCount: number
  reactionCounts: Record<string, number>
  myReaction: string | null
  lastCommentedAt: Date
}
