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
}

export interface CreatePostDTO {
  communityId: string
  title: string
  content: string
  tags: string[]
  imageUrls: string[]
  videos: PostVideoInput[]
}

export interface UpdatePostDTO {
  title?: string | undefined
  content?: string | undefined
  tags?: string[] | undefined
  imageUrls?: string[] | undefined
  videos?: PostVideoInput[] | undefined
}

export interface PostResponseDTO {
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

export interface PostFeedItemDTO {
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
}

export interface ListPostsResponseDTO {
  posts: PostFeedItemDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CommentedPostItemDTO {
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
