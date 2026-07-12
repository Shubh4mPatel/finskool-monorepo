import type { PrismaClient } from '../../generated/prisma/client.js'
import { uploadFile, deleteFile } from '../../lib/minio.js'
import { notificationsQueue, COMMUNITY_POST_JOB } from '../../lib/queue.js'
import { NotFoundError, BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  CreatePostDTO,
  UpdatePostDTO,
  PostResponseDTO,
  PostFeedItemDTO,
  ListPostsResponseDTO,
  CommentedPostItemDTO,
} from './posts.dto.js'

export class PostsService {
  constructor(private readonly db: PrismaClient) {}

  async listPosts(params: {
    page: number
    pageSize: number
    communityId?: string
    communityIds?: string[]
  }): Promise<ListPostsResponseDTO> {
    const { page, pageSize, communityId, communityIds } = params
    const where = {
      status: 'published' as const,
      deletedAt: null,
      ...(communityId !== undefined
        ? { communityId }
        : communityIds !== undefined
          ? { communityId: { in: communityIds } }
          : {}),
    }

    const [posts, total] = await Promise.all([
      this.db.post.findMany({
        where,
        include: {
          community: { select: { name: true, slug: true } },
          _count: { select: { comments: { where: { deletedAt: null } } } },
        },
        orderBy: [{ pinOrder: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.post.count({ where }),
    ])

    return {
      posts: posts.map(p => ({
        id: p.id,
        communityId: p.communityId,
        communityName: p.community.name,
        communitySlug: p.community.slug,
        title: p.title,
        content: p.contentMd,
        imageUrls: p.imageUrls,
        tags: p.tags,
        pinOrder: p.pinOrder,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
        commentCount: p._count.comments,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async listCommentedPosts(userId: string): Promise<CommentedPostItemDTO[]> {
    const grouped = await this.db.comment.groupBy({
      by: ['postId'],
      where: { authorId: userId, deletedAt: null },
      _max: { createdAt: true },
    })
    if (grouped.length === 0) return []

    const lastCommentedByPost = new Map(grouped.map(g => [g.postId, g._max.createdAt!]))

    const posts = await this.db.post.findMany({
      where: { id: { in: grouped.map(g => g.postId) }, deletedAt: null },
      include: {
        community: { select: { name: true, slug: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
    })

    return posts
      .map(p => ({
        id: p.id,
        communityId: p.communityId,
        communityName: p.community.name,
        communitySlug: p.community.slug,
        title: p.title,
        content: p.contentMd,
        imageUrls: p.imageUrls,
        tags: p.tags,
        pinOrder: p.pinOrder,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
        commentCount: p._count.comments,
        lastCommentedAt: lastCommentedByPost.get(p.id)!,
      }))
      .sort((a, b) => b.lastCommentedAt.getTime() - a.lastCommentedAt.getTime())
  }

  async createPost(adminId: string, data: CreatePostDTO): Promise<PostResponseDTO> {
    const community = await this.db.community.findUnique({
      where: { id: data.communityId, deletedAt: null },
    })
    if (!community) throw new NotFoundError('Community not found')

    const post = await this.db.post.create({
      data: {
        communityId: data.communityId,
        authorId: adminId,
        title: data.title,
        contentMd: data.content,
        imageUrls: data.imageUrls,
        tags: data.tags,
      },
    })

    logger.info({ postId: post.id }, 'posts.create: success')
    return this.toResponse(post)
  }

  async updatePost(postId: string, data: UpdatePostDTO): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')

    let imageUrls = post.imageUrls

    if (data.imageUrls !== undefined) {
      // delete any old images that are no longer in the new list
      const removed = post.imageUrls.filter(url => !data.imageUrls!.includes(url))
      if (removed.length > 0) {
        await Promise.all(removed.map(url => deleteFile(url)))
      }
      imageUrls = data.imageUrls
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

    try {
      await notificationsQueue.add(
        COMMUNITY_POST_JOB,
        {
          communityId: updated.communityId,
          postId: updated.id,
          message: `New post: "${updated.title}"`,
          triggeredByUserId: updated.authorId,
        },
        {
          jobId: `post-published-${updated.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { count: 500 },
        },
      )
    } catch (err) {
      // Publish already succeeded at the DB level — a queue/Redis outage
      // shouldn't fail the request.
      logger.error({ err, postId: updated.id }, 'posts.publish: failed to enqueue notification job')
    }

    logger.info({ postId }, 'posts.publish: success')
    return this.toResponse(updated)
  }

  async pinPost(postId: string, pinOrder: 1 | 2 | 3 | null): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')

    const updated = await this.db.$transaction(async tx => {
      // If pinning, auto-unpin any existing pinned post in the same community
      if (pinOrder !== null) {
        await tx.post.updateMany({
          where: {
            communityId: post.communityId,
            pinOrder,
            deletedAt: null,
            id: { not: postId },
          },
          data: { pinOrder: null, pinnedAt: null },
        })
      }

      return tx.post.update({
        where: { id: postId },
        data: {
          pinOrder,
          pinnedAt: pinOrder !== null ? new Date() : null,
        },
      })
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
