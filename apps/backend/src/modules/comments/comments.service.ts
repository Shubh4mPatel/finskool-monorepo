import type { PrismaClient, UserRole } from '../../generated/prisma/client.js'
import { NotFoundError, ForbiddenError, BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type { CreateCommentDTO, CommentTreeDTO, CommentListDTO } from './comments.dto.js'

export class CommentsService {
  constructor(private readonly db: PrismaClient) {}

  async createComment(
    userId: string,
    userRole: UserRole,
    postId: string,
    data: CreateCommentDTO,
  ): Promise<CommentTreeDTO> {
    const post = await this.db.post.findUnique({
      where: { id: postId, deletedAt: null, status: 'published' },
      select: { id: true, communityId: true, title: true },
    })
    if (!post) throw new NotFoundError('Post not found or not published')

    if (userRole !== 'admin') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const subscription = await this.db.subscription.findFirst({
        where: { userId, communityId: post.communityId, isActive: true, validUntil: { gte: today } },
      })
      if (!subscription) throw new ForbiddenError('You must be a community member to comment')
    }

    let depth = 0
    let parentPath: string | null = null
    let parentId: string | null = null
    let parentAuthorId: string | null = null
    let parentAuthorRole: string | null = null

    if (data.parentCommentId) {
      const parent = await this.db.comment.findUnique({
        where: { id: data.parentCommentId, deletedAt: null },
        select: { id: true, postId: true, authorId: true, depth: true, path: true, author: { select: { role: true } } },
      })
      if (!parent) throw new NotFoundError('Parent comment not found')
      if (parent.postId !== postId) {
        throw new BadRequestError('Parent comment does not belong to this post')
      }
      depth = parent.depth + 1
      parentPath = parent.path
      parentId = parent.id
      parentAuthorId = parent.authorId
      parentAuthorRole = parent.author.role
    }

    // Notify admin when: commenter is not admin AND (top-level comment OR reply to admin's comment)
    const shouldNotify = userRole !== 'admin' && (depth === 0 || parentAuthorRole === 'admin')

    // create with temp path, then update with real path (needs the new id)
    const comment = await this.db.$transaction(async tx => {
      const created = await tx.comment.create({
        data: { postId, authorId: userId, content: data.content, parentId, depth, path: 'tmp' },
        select: { id: true, createdAt: true },
      })
      const path = parentPath ? `${parentPath}/${created.id}` : created.id

      if (shouldNotify) {
        await tx.commentNotification.create({ data: { commentId: created.id, postId } })
      }

      // When admin replies to a notified comment, auto-mark that notification as replied
      if (userRole === 'admin' && parentId) {
        await tx.commentNotification.updateMany({
          where: { commentId: parentId, isReplied: false },
          data: { isReplied: true, repliedAt: new Date() },
        })
      }

      // Notify the parent comment's author on reply — synchronous (single row),
      // same transaction as the comment write. Skip self-replies.
      if (parentId && parentAuthorId && parentAuthorId !== userId) {
        const replier = await tx.user.findUnique({ where: { id: userId }, select: { name: true } })
        await tx.notification.create({
          data: {
            communityId: post.communityId,
            userId: parentAuthorId,
            type: 'thread',
            sourceId: created.id,
            message: `${replier?.name ?? 'Someone'} replied to your comment on "${post.title}"`,
          },
        })
      }

      return tx.comment.update({
        where: { id: created.id },
        data: { path },
        select: {
          id: true,
          content: true,
          depth: true,
          createdAt: true,
          author: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
      })
    })

    logger.info({ commentId: comment.id, postId, depth }, 'comments.create: success')
    return { ...comment, notification: null, replies: [] }
  }

  async listComments(postId: string, cursor: string | undefined, limit: number): Promise<CommentListDTO> {
    const post = await this.db.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    })
    if (!post) throw new NotFoundError('Post not found')

    // fetch one extra to determine hasMore
    const topLevel = await this.db.comment.findMany({
      where: { postId, parentId: null, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        content: true,
        depth: true,
        path: true,
        createdAt: true,
        author: { select: { id: true, name: true, role: true, avatarUrl: true } },
        notification: { select: { id: true, isReplied: true } },
      },
    })

    const hasMore = topLevel.length > limit
    const page = hasMore ? topLevel.slice(0, limit) : topLevel

    if (page.length === 0) return { comments: [], nextCursor: null, hasMore: false }

    // fetch ALL descendants for this page in one query using materialized path
    const descendants = await this.db.comment.findMany({
      where: {
        postId,
        deletedAt: null,
        OR: page.map(c => ({ path: { startsWith: `${c.id}/` } })),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        content: true,
        depth: true,
        parentId: true,
        createdAt: true,
        author: { select: { id: true, name: true, role: true, avatarUrl: true } },
        notification: { select: { id: true, isReplied: true } },
      },
    })

    // build tree in memory — map holds dto + parentId for wiring
    type NodeEntry = { dto: CommentTreeDTO; parentId: string | null }
    const map = new Map<string, NodeEntry>()

    for (const c of page) {
      map.set(c.id, {
        dto: { id: c.id, content: c.content, author: c.author, depth: c.depth, createdAt: c.createdAt, notification: c.notification, replies: [] },
        parentId: null,
      })
    }
    for (const c of descendants) {
      map.set(c.id, {
        dto: { id: c.id, content: c.content, author: c.author, depth: c.depth, createdAt: c.createdAt, notification: c.notification, replies: [] },
        parentId: c.parentId,
      })
    }

    const roots: CommentTreeDTO[] = []
    for (const [, entry] of map) {
      if (entry.parentId === null) {
        roots.push(entry.dto)
      } else {
        const parent = map.get(entry.parentId)
        if (parent) parent.dto.replies.push(entry.dto)
      }
    }

    const lastComment = page.at(-1)
    return {
      comments: roots,
      nextCursor: hasMore && lastComment ? lastComment.id : null,
      hasMore,
    }
  }

  async deleteComment(commentId: string, userId: string, userRole: UserRole): Promise<void> {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId, deletedAt: null },
      select: { id: true, authorId: true, path: true, postId: true },
    })
    if (!comment) throw new NotFoundError('Comment not found')
    if (userRole !== 'admin' && comment.authorId !== userId) {
      throw new ForbiddenError('You can only delete your own comments')
    }
    if (userRole !== 'admin') {
      const replyCount = await this.db.comment.count({
        where: { parentId: commentId, deletedAt: null },
      })
      if (replyCount > 0) {
        throw new ForbiddenError('Cannot delete a comment that has been replied to', 'HAS_REPLIES')
      }
    }

    // soft-delete the comment AND all its descendants via materialized path
    await this.db.comment.updateMany({
      where: {
        postId: comment.postId,
        deletedAt: null,
        OR: [{ id: commentId }, { path: { startsWith: `${comment.path}/` } }],
      },
      data: { deletedAt: new Date() },
    })

    logger.info({ commentId, userId }, 'comments.delete: soft deleted with descendants')
  }
}
