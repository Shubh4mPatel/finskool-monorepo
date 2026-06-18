import type { PrismaClient } from '../../generated/prisma/client.js'
import { uploadFile, deleteFile } from '../../lib/minio.js'
import { NotFoundError, ConflictError, BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type { CreatePostDTO, UpdatePostDTO, PostResponseDTO } from './posts.dto.js'

export class PostsService {
  constructor(private readonly db: PrismaClient) {}

  async createPost(
    adminId: string,
    data: CreatePostDTO,
    imageFiles: Express.Multer.File[],
  ): Promise<PostResponseDTO> {
    const community = await this.db.community.findUnique({
      where: { id: data.communityId, deletedAt: null },
    })
    if (!community) throw new NotFoundError('Community not found')

    const imageUrls = await Promise.all(
      imageFiles.map(f => uploadFile(f.buffer, f.originalname, f.mimetype)),
    )

    const post = await this.db.post.create({
      data: {
        communityId: data.communityId,
        authorId: adminId,
        title: data.title,
        contentMd: data.content,
        imageUrls,
        tags: data.tags,
      },
    })

    logger.info({ postId: post.id }, 'posts.create: success')
    return this.toResponse(post)
  }

  async updatePost(
    postId: string,
    data: UpdatePostDTO,
    imageFiles: Express.Multer.File[],
  ): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')

    let imageUrls = post.imageUrls

    if (imageFiles.length > 0) {
      // delete old images from MinIO then replace
      await Promise.all(post.imageUrls.map(url => deleteFile(url)))
      imageUrls = await Promise.all(
        imageFiles.map(f => uploadFile(f.buffer, f.originalname, f.mimetype)),
      )
    }

    const updated = await this.db.post.update({
      where: { id: postId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { contentMd: data.content }),
        ...(data.tags !== undefined && { tags: data.tags }),
        imageUrls,
      },
    })

    return this.toResponse(updated)
  }

  async deletePost(postId: string): Promise<void> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')

    await this.db.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    })

    logger.info({ postId }, 'posts.delete: soft deleted')
  }

  async publishPost(postId: string): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    if (post.status === 'published') throw new BadRequestError('Post is already published')

    const updated = await this.db.post.update({
      where: { id: postId },
      data: { status: 'published', publishedAt: new Date() },
    })

    logger.info({ postId }, 'posts.publish: success')
    return this.toResponse(updated)
  }

  async pinPost(postId: string, pinOrder: 1 | 2 | 3 | null): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')

    if (pinOrder !== null) {
      // check if slot is already taken by another post in the same community
      const conflict = await this.db.post.findFirst({
        where: {
          communityId: post.communityId,
          pinOrder,
          deletedAt: null,
          id: { not: postId },
        },
      })
      if (conflict) {
        throw new ConflictError(
          `Pin slot ${pinOrder} is already taken. Unpin that post first.`,
          'PIN_SLOT_TAKEN',
        )
      }
    }

    const updated = await this.db.post.update({
      where: { id: postId },
      data: {
        pinOrder,
        pinnedAt: pinOrder !== null ? new Date() : null,
      },
    })

    logger.info({ postId, pinOrder }, 'posts.pin: success')
    return this.toResponse(updated)
  }

  private toResponse(post: {
    id: string
    communityId: string
    authorId: string
    title: string
    contentMd: string
    imageUrls: string[]
    tags: string[]
    status: string
    pinOrder: number | null
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }): PostResponseDTO {
    return {
      id: post.id,
      communityId: post.communityId,
      authorId: post.authorId,
      title: post.title,
      content: post.contentMd,
      imageUrls: post.imageUrls,
      tags: post.tags,
      status: post.status,
      pinOrder: post.pinOrder,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    }
  }
}
