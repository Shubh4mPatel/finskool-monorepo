export interface CreatePostDTO {
  communityId: string
  title: string
  content: string
  tags: string[]
}

export interface UpdatePostDTO {
  title?: string
  content?: string
  tags?: string[]
}

export interface PinPostDTO {
  pinOrder: 1 | 2 | 3 | null
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
