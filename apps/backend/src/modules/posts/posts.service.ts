import type { PrismaClient, Prisma } from '../../generated/prisma/client.js'
import { uploadFile, deleteFile } from '../../lib/minio.js'
import { notificationsQueue, COMMUNITY_POST_JOB } from '../../lib/queue.js'
import { assertCommunityAccess } from '../../lib/community-access.js'
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
          author: { select: { name: true, avatarUrl: true } },
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
        authorName: p.author.name,
        authorAvatarUrl: p.author.avatarUrl,
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
    await assertCommunityAccess(this.db, adminId, data.communityId)

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

  async updatePost(postId: string, adminId: string, data: UpdatePostDTO): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    await assertCommunityAccess(this.db, adminId, post.communityId)

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

  async deletePost(postId: string, adminId: string): Promise<void> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    await assertCommunityAccess(this.db, adminId, post.communityId)

    await this.db.$transaction(async tx => {
      await tx.post.update({
        where: { id: postId },
        // Clear pin fields too — the DB's unique (communityId, pinOrder) index applies
        // regardless of deletedAt, so a deleted post left pinned would permanently
        // block any other post in the community from taking that pin slot.
        data: { deletedAt: new Date(), pinOrder: null, pinnedAt: null, pinnedBy: null },
      })

      if (post.pinOrder !== null) {
        await this.compactPinnedPosts(tx, post.communityId, post.pinOrder)
      }
    })

    logger.info({ postId }, 'posts.delete: soft deleted')
  }

  async publishPost(postId: string, adminId: string): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    await assertCommunityAccess(this.db, adminId, post.communityId)
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

  /**
   * Toggles pin state for a post. Pinning always places the post at slot 1,
   * pushing every other pinned post in the community down one slot; whatever
   * falls off slot 3 is evicted (fully unpinned). Unpinning clears the post's
   * slot and compacts the posts below it up by one so pinned slots always
   * stay contiguous (1..N, N <= 3). The caller only supplies the post id —
   * pin vs. unpin is derived from the post's current pinOrder.
   */
  async pinPost(postId: string, adminId: string): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    await assertCommunityAccess(this.db, adminId, post.communityId)

    const updated = await this.db.$transaction(async tx => {
      if (post.pinOrder !== null) {
        await tx.post.update({
          where: { id: postId },
          data: { pinOrder: null, pinnedAt: null, pinnedBy: null },
        })
        await this.compactPinnedPosts(tx, post.communityId, post.pinOrder)
        return tx.post.findUniqueOrThrow({ where: { id: postId } })
      }

      // Push every currently-pinned post down one slot, highest slot first so
      // each move lands on a slot already vacated by the previous step.
      const pinned = await tx.post.findMany({
        where: { communityId: post.communityId, deletedAt: null, pinOrder: { not: null } },
        orderBy: { pinOrder: 'desc' },
      })
      for (const p of pinned) {
        if (p.pinOrder! >= 3) {
          await tx.post.update({
            where: { id: p.id },
            data: { pinOrder: null, pinnedAt: null, pinnedBy: null },
          })
        } else {
          await tx.post.update({
            where: { id: p.id },
            data: { pinOrder: p.pinOrder! + 1 },
          })
        }
      }

      return tx.post.update({
        where: { id: postId },
        data: { pinOrder: 1, pinnedAt: new Date(), pinnedBy: adminId },
      })
    })

    logger.info({ postId, pinOrder: updated.pinOrder }, 'posts.pin: success')
    return this.toResponse(updated)
  }

  /** Shifts every pinned post below `removedOrder` up by one slot, in ascending order so each move lands on an already-vacated slot. */
  private async compactPinnedPosts(
    tx: Prisma.TransactionClient,
    communityId: string,
    removedOrder: number,
  ): Promise<void> {
    const below = await tx.post.findMany({
      where: { communityId, deletedAt: null, pinOrder: { gt: removedOrder } },
      orderBy: { pinOrder: 'asc' },
    })
    for (const p of below) {
      await tx.post.update({ where: { id: p.id }, data: { pinOrder: p.pinOrder! - 1 } })
    }
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
