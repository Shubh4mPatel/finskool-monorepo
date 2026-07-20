export interface CreatePostDTO {
  communityId: string
  title: string
  content: string
  tags: string[]
  imageUrls: string[]
}

export interface UpdatePostDTO {
  title?: string | undefined
  content?: string | undefined
  tags?: string[] | undefined
  imageUrls?: string[] | undefined
}

export interface PostResponseDTO {
  id: string
  communityId: string
  authorId: string
  title: string
  content: string
  imageUrls: string[]
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
  authorName: string
  authorAvatarUrl: string | null
  title: string
  content: string
  imageUrls: string[]
  tags: string[]
  pinOrder: number | null
  publishedAt: Date | null
  createdAt: Date
  commentCount: number
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
  title: string
  content: string
  imageUrls: string[]
  tags: string[]
  pinOrder: number | null
  publishedAt: Date | null
  createdAt: Date
  commentCount: number
  lastCommentedAt: Date
}
