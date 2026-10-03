import type { PrismaClient, Prisma } from '../../generated/prisma/client.js'
import { uploadFile, deleteFile, statUploadedVideo, MAX_VIDEO_BYTES, VIDEO_TYPES_BY_EXT } from '../../lib/minio.js'
import { parseVideoLink, fetchYoutubeTitle } from '../../lib/video-links.js'
import { notificationsQueue, COMMUNITY_POST_JOB } from '../../lib/queue.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { truncateText } from '../../lib/email-templates.js'
import { NotFoundError, BadRequestError, ForbiddenError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  CreatePostDTO,
  UpdatePostDTO,
  PostResponseDTO,
  PostFeedItemDTO,
  ListPostsResponseDTO,
  CommentedPostItemDTO,
  PostVideoDTO,
  PostVideoInput,
} from './posts.dto.js'

const VIDEO_INCLUDE = { videos: { orderBy: { position: 'asc' as const } } }

type VideoRow = {
  id: string
  kind: 'file' | 'youtube' | 'instagram'
  url: string
  externalId: string | null
  title: string | null
  thumbnailUrl: string | null
}

export function toVideoDTO(v: VideoRow): PostVideoDTO {
  // Same builder as lib/video-links.ts (embed URL derived from the stored ID, never stored itself).
  const embedUrl =
    v.kind === 'youtube' && v.externalId
      ? `https://www.youtube-nocookie.com/embed/${v.externalId}`
      : v.kind === 'instagram'
        ? `${v.url.replace(/\/$/, '')}/embed`
        : null
  return { id: v.id, kind: v.kind, url: v.url, embedUrl, externalId: v.externalId, title: v.title, thumbnailUrl: v.thumbnailUrl }
}

export class PostsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Live DB check (not the communityIds cached on the member's JWT/mobile
   * session at login) — used only for the mobile app's explicit ?communityId
   * param on GET /posts, where a member picks a community to view directly
   * rather than relying on whatever was current at their last login/session
   * refresh. Catches both "never subscribed" and "subscription expired since
   * login" with the same check and the same error, same as
   * auth.service.ts/mobile-auth.service.ts's own hasActiveSubscription.
   */
  async assertMemberSubscribed(userId: string, communityId: string): Promise<void> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const count = await this.db.subscription.count({
      where: { userId, communityId, isActive: true, validUntil: { gte: today } },
    })
    if (count === 0) {
      throw new ForbiddenError(
        'You do not have an active subscription to this community.',
        'SUBSCRIPTION_REQUIRED',
      )
    }
  }

  /**
   * Which community GET /mobile/posts should serve, or null if there's
   * nothing to show (no `requestedId` and no free community exists). No
   * `requestedId` means the free community. Access is checked live for every
   * community, free included: members need an active, unexpired subscription
   * (every account gets one for the free community — see
   * lib/free-community.ts); admins can always read the free community and
   * need a community grant for any paid one.
   */
  async resolveMobileFeedCommunity(
    user: { id: string; role: string; accessibleCommunityIds: string[] | null },
    requestedId: string | undefined,
  ): Promise<string | null> {
    let communityId: string
    let isFree: boolean

    if (requestedId === undefined) {
      const free = await this.db.community.findFirst({
        where: { isFree: true, deletedAt: null },
        select: { id: true },
      })
      if (!free) return null
      communityId = free.id
      isFree = true
    } else {
      const community = await this.db.community.findUnique({
        where: { id: requestedId },
        select: { isFree: true, deletedAt: true },
      })
      if (!community || community.deletedAt) throw new NotFoundError('Community not found')
      communityId = requestedId
      isFree = community.isFree
    }

    if (user.role === 'admin') {
      if (!isFree) assertCommunityAccessFromToken(user.accessibleCommunityIds, communityId)
    } else {
      await this.assertMemberSubscribed(user.id, communityId)
    }
    return communityId
  }

  async listPosts(params: {
    userId: string
    page: number
    pageSize: number
    communityId?: string
    communityIds?: string[]
    date?: string
    order?: 'asc' | 'desc'
  }): Promise<ListPostsResponseDTO> {
    const { userId, page, pageSize, communityId, communityIds, date, order = 'desc' } = params
    // Anchored to IST (+05:30), not UTC — the frontend displays/labels dates in
    // en-IN local time, so a "day" here must match what the user sees on a post
    // card, not the UTC calendar day the timestamp happens to fall on.
    const dayStart = date ? new Date(`${date}T00:00:00.000+05:30`) : undefined
    const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) : undefined

    const where = {
      status: 'published' as const,
      deletedAt: null,
      ...(communityId !== undefined
        ? { communityId }
        : communityIds !== undefined
          ? { communityId: { in: communityIds } }
          : {}),
      ...(dayStart && dayEnd ? { publishedAt: { gte: dayStart, lt: dayEnd } } : {}),
    }

    const [posts, total] = await Promise.all([
      this.db.post.findMany({
        where,
        include: {
          ...VIDEO_INCLUDE,
          community: { select: { name: true, slug: true, badgeUrl: true } },
          author: { select: { name: true, avatarUrl: true } },
          _count: { select: { comments: { where: { deletedAt: null } } } },
          reactions: { where: { userId }, select: { reactionType: { select: { name: true } } }, take: 1 },
        },
        orderBy: [{ pinOrder: { sort: 'asc', nulls: 'last' } }, { publishedAt: order }],
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
        communityBadgeUrl: p.community.badgeUrl,
        authorName: p.author.name,
        authorAvatarUrl: p.author.avatarUrl,
        title: p.title,
        content: p.contentMd,
        imageUrls: p.imageUrls,
        videos: p.videos.map(toVideoDTO),
        tags: p.tags,
        pinOrder: p.pinOrder,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
        commentCount: p._count.comments,
        reactionCounts: (p.reactionCounts as Record<string, number> | null) ?? {},
        myReaction: p.reactions[0]?.reactionType.name ?? null,
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
        ...VIDEO_INCLUDE,
        community: { select: { name: true, slug: true, badgeUrl: true } },
        author: { select: { name: true, avatarUrl: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
        reactions: { where: { userId }, select: { reactionType: { select: { name: true } } }, take: 1 },
      },
    })

    return posts
      .map(p => ({
        id: p.id,
        communityId: p.communityId,
        communityName: p.community.name,
        communitySlug: p.community.slug,
        communityBadgeUrl: p.community.badgeUrl,
        authorName: p.author.name,
        authorAvatarUrl: p.author.avatarUrl,
        title: p.title,
        content: p.contentMd,
        imageUrls: p.imageUrls,
        videos: p.videos.map(toVideoDTO),
        tags: p.tags,
        pinOrder: p.pinOrder,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
        commentCount: p._count.comments,
        reactionCounts: (p.reactionCounts as Record<string, number> | null) ?? {},
        myReaction: p.reactions[0]?.reactionType.name ?? null,
        lastCommentedAt: lastCommentedByPost.get(p.id)!,
      }))
      .sort((a, b) => b.lastCommentedAt.getTime() - a.lastCommentedAt.getTime())
  }

  async createPost(
    adminId: string,
    accessibleCommunityIds: string[] | null,
    data: CreatePostDTO,
  ): Promise<PostResponseDTO> {
    const community = await this.db.community.findUnique({
      where: { id: data.communityId, deletedAt: null },
    })
    if (!community) throw new NotFoundError('Community not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, data.communityId)

    const videos = await this.resolveVideos(data.videos)

    const post = await this.db.post.create({
      data: {
        communityId: data.communityId,
        authorId: adminId,
        title: data.title,
        contentMd: data.content,
        imageUrls: data.imageUrls,
        tags: data.tags,
        videos: { create: videos.map((v, position) => ({ ...v, position })) },
      },
      include: VIDEO_INCLUDE,
    })

    logger.info({ postId: post.id }, 'posts.create: success')
    return this.toResponse(post)
  }

  async updatePost(
    postId: string,
    adminId: string,
    accessibleCommunityIds: string[] | null,
    data: UpdatePostDTO,
  ): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)

    const imageUrls = data.imageUrls ?? post.imageUrls
    const videos = data.videos !== undefined ? await this.resolveVideos(data.videos) : undefined

    const previousVideoFiles =
      videos !== undefined
        ? (await this.db.postVideo.findMany({ where: { postId, kind: 'file' }, select: { url: true } })).map(v => v.url)
        : []

    const updated = await this.db.post.update({
      where: { id: postId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { contentMd: data.content }),
        ...(data.tags !== undefined && { tags: data.tags }),
        imageUrls,
        ...(videos !== undefined && {
          videos: { deleteMany: {}, create: videos.map((v, position) => ({ ...v, position })) },
        }),
      },
      include: VIDEO_INCLUDE,
    })

    // Files are removed only after the DB no longer references them — and only if no other
    // post does either (publishing to several targets makes one copy per target, all
    // pointing at the same uploaded file).
    const removed = [
      ...post.imageUrls.filter(url => !imageUrls.includes(url)),
      ...previousVideoFiles.filter(url => !(videos ?? []).some(v => v.url === url)),
    ]
    await Promise.all(removed.map(url => this.deleteFileIfUnreferenced(url)))

    return this.toResponse(updated)
  }

  /** Link metadata for the admin UI's "add video link" box — nothing is saved. */
  async previewVideoLink(url: string) {
    const parsed = parseVideoLink(url)
    if (!parsed) throw new BadRequestError('Enter a valid YouTube or Instagram video link')
    const title = parsed.kind === 'youtube' ? await fetchYoutubeTitle(parsed.canonicalUrl) : null
    return { ...parsed, title }
  }

  /**
   * Turns what the admin UI sent into rows to store. Provider IDs, canonical URLs and
   * thumbnails are re-derived here (the client only ever supplies a URL and an optional
   * display title), uploaded files are verified in MinIO, and duplicates are rejected.
   */
  private async resolveVideos(inputs: PostVideoInput[]) {
    const seen = new Set<string>()
    const rows: Array<{
      kind: 'file' | 'youtube' | 'instagram'
      url: string
      externalId: string | null
      title: string | null
      thumbnailUrl: string | null
    }> = []

    for (const input of inputs) {
      let row: (typeof rows)[number]

      if (input.kind === 'file') {
        const stat = await statUploadedVideo(input.url)
        if (!stat) throw new BadRequestError('Uploaded video was not found — please upload it again')
        if (stat.size > MAX_VIDEO_BYTES) {
          throw new BadRequestError(`Videos can be at most ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB`)
        }
        if (!Object.values(VIDEO_TYPES_BY_EXT).includes(stat.contentType)) {
          throw new BadRequestError('Only MP4 and MOV videos can be uploaded')
        }
        row = { kind: 'file', url: input.url, externalId: null, title: input.title ?? null, thumbnailUrl: null }
      } else {
        const parsed = parseVideoLink(input.url)
        if (!parsed || parsed.kind !== input.kind) {
          throw new BadRequestError(
            input.kind === 'youtube' ? 'Enter a valid YouTube video link' : 'Enter a valid Instagram post or reel link',
          )
        }
        const title = input.title ?? (parsed.kind === 'youtube' ? await fetchYoutubeTitle(parsed.canonicalUrl) : null)
        row = { kind: parsed.kind, url: parsed.canonicalUrl, externalId: parsed.externalId, title, thumbnailUrl: parsed.thumbnailUrl }
      }

      const key = `${row.kind}:${row.externalId ?? row.url}`
      if (seen.has(key)) throw new BadRequestError('The same video was added more than once')
      seen.add(key)
      rows.push(row)
    }
    return rows
  }

  private async deleteFileIfUnreferenced(url: string): Promise<void> {
    try {
      const [images, videos] = await Promise.all([
        this.db.post.count({ where: { imageUrls: { has: url } } }),
        this.db.postVideo.count({ where: { url } }),
      ])
      if (images + videos === 0) await deleteFile(url)
    } catch (err) {
      // The post is already saved; a leftover file is harmless, a failed request is not.
      logger.warn({ err, url }, 'posts: failed to delete unreferenced file')
    }
  }

  async deletePost(postId: string, adminId: string, accessibleCommunityIds: string[] | null): Promise<void> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)

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

  async publishPost(
    postId: string,
    adminId: string,
    accessibleCommunityIds: string[] | null,
  ): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)
    if (post.status === 'published') throw new BadRequestError('Post is already published')

    const updated = await this.db.post.update({
      where: { id: postId },
      data: { status: 'published', publishedAt: new Date() },
      include: VIDEO_INCLUDE,
    })

    try {
      await notificationsQueue.add(
        COMMUNITY_POST_JOB,
        {
          communityId: updated.communityId,
          postId: updated.id,
          message: `New post: "${updated.title}"`,
          triggeredByUserId: updated.authorId,
          postTitle: updated.title,
          postExcerpt: truncateText(updated.contentMd),
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
  async pinPost(
    postId: string,
    adminId: string,
    accessibleCommunityIds: string[] | null,
  ): Promise<PostResponseDTO> {
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null } })
    if (!post) throw new NotFoundError('Post not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)

    const updated = await this.db.$transaction(async tx => {
      if (post.pinOrder !== null) {
        await tx.post.update({
          where: { id: postId },
          data: { pinOrder: null, pinnedAt: null, pinnedBy: null },
        })
        await this.compactPinnedPosts(tx, post.communityId, post.pinOrder)
        return tx.post.findUniqueOrThrow({ where: { id: postId }, include: VIDEO_INCLUDE })
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
        include: VIDEO_INCLUDE,
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
    videos: VideoRow[]
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
      videos: post.videos.map(toVideoDTO),
      tags: post.tags,
      status: post.status,
      pinOrder: post.pinOrder,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    }
  }
}
