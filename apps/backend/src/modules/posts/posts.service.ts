import type { PrismaClient, Prisma } from '../../generated/prisma/client.js'
import {
  uploadFile,
  deleteFile,
  statUploadedVideo,
  readOwnObject,
  internalReadUrl,
  existingVideoPosterUrl,
  videoPosterUrl,
  MAX_VIDEO_BYTES,
  VIDEO_TYPES_BY_EXT,
  VIDEO_FOLDER,
  POST_IMAGE_FOLDER,
  MAX_POST_IMAGE_BYTES,
} from '../../lib/minio.js'
import { inspectImage, inspectVideo, orientationOf, ratioOf } from '../../lib/media-info.js'
import { parseVideoLink, fetchYoutubeTitle } from '../../lib/video-links.js'
import { notificationsQueue, COMMUNITY_POST_JOB } from '../../lib/queue.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { truncateText } from '../../lib/email-templates.js'
import { NotFoundError, BadRequestError, ForbiddenError } from '../../shared/errors/index.js'
import { isUuid } from '../tickets/tickets.shared.js'
import { logger } from '../../shared/logger.js'
import { notExpired } from '../../lib/subscription-expiry.js'
import { assertNotBlocked } from '../../lib/community-block.js'
import type {
  CreatePostDTO,
  UpdatePostDTO,
  PostResponseDTO,
  PostFeedItemDTO,
  ListPostsResponseDTO,
  CommentedPostItemDTO,
  PostVideoDTO,
  PostVideoInput,
  PostImageDTO,
  PostMediaShapeDTO,
} from './posts.dto.js'

// Everything a post response needs about its media.
const VIDEO_INCLUDE = {
  videos: { orderBy: { position: 'asc' as const } },
  images: { orderBy: { position: 'asc' as const } },
}

type VideoRow = {
  id: string
  kind: 'file' | 'youtube' | 'instagram'
  url: string
  externalId: string | null
  title: string | null
  thumbnailUrl: string | null
  width?: number | null
  height?: number | null
  durationSec?: number | null
}

type ImageRow = { url: string; width: number; height: number }

interface MediaShapeRow {
  imageUrls: string[]
  images?: ImageRow[]
  videos: VideoRow[]
  mediaWidth: number | null
  mediaHeight: number | null
  mediaRatio: number | null
  mediaOrientation: 'portrait' | 'landscape' | null
}

const sizeFields = (w: number | null | undefined, h: number | null | undefined) =>
  w && h ? { width: w, height: h, ratio: ratioOf({ width: w, height: h }) } : { width: null, height: null, ratio: null }

/** images / ratio / orientation for a response. Images of a post not re-saved since sizes were stored come back with null sizes. */
export function toMediaShape(post: MediaShapeRow): PostMediaShapeDTO {
  const bySize = new Map((post.images ?? []).map(i => [i.url, i]))
  const images: PostImageDTO[] = post.imageUrls.map(url => {
    const row = bySize.get(url)
    const size = row ? { width: row.width, height: row.height } : null
    return { url, ...sizeFields(size?.width, size?.height), orientation: size ? orientationOf(size) : null }
  })
  return {
    images,
    mediaWidth: post.mediaWidth,
    mediaHeight: post.mediaHeight,
    ratio: post.mediaRatio,
    orientation: post.mediaOrientation,
  }
}

/** The post's shape, from its first sized media: images first, then uploaded videos. Links have no size. */
function leadShape(images: ImageRow[], videos: Array<{ width: number | null; height: number | null }>) {
  const lead = images[0] ?? videos.find(v => v.width && v.height)
  if (!lead || !lead.width || !lead.height) {
    return { mediaWidth: null, mediaHeight: null, mediaRatio: null, mediaOrientation: null }
  }
  const size = { width: lead.width, height: lead.height }
  return { mediaWidth: size.width, mediaHeight: size.height, mediaRatio: ratioOf(size), mediaOrientation: orientationOf(size) }
}

export function toVideoDTO(v: VideoRow): PostVideoDTO {
  // Same builder as lib/video-links.ts (embed URL derived from the stored ID, never stored itself).
  const embedUrl =
    v.kind === 'youtube' && v.externalId
      ? `https://www.youtube-nocookie.com/embed/${v.externalId}`
      : v.kind === 'instagram'
        ? `${v.url.replace(/\/$/, '')}/embed`
        : null
  return {
    id: v.id,
    kind: v.kind,
    url: v.url,
    embedUrl,
    externalId: v.externalId,
    title: v.title,
    thumbnailUrl: v.thumbnailUrl,
    ...sizeFields(v.width, v.height),
    durationSec: v.durationSec ?? null,
  }
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&')

// ─── List cursor ────────────────────────────────────────────────────────────
// Opaque "<pinOrder or empty>|<iso publishedAt>|<id>" — keyset pagination on the feed's own order
// (pinned first by pinOrder, then publishedAt, then id), so a page boundary stays put while posts are
// published or deleted around it.

interface PostCursor {
  pinOrder: number | null
  at: Date
  id: string
}

function encodePostCursor(post: { pinOrder: number | null; publishedAt: Date; id: string }): string {
  return Buffer.from(`${post.pinOrder ?? ''}|${post.publishedAt.toISOString()}|${post.id}`).toString('base64url')
}

function decodePostCursor(cursor: string): PostCursor {
  const [pin, iso, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  const pinOrder = pin === undefined || pin === '' ? null : Number(pin)
  const at = new Date(iso ?? '')
  // The id goes straight into a uuid-column comparison: anything else would surface as a 500.
  if (
    !id ||
    !isUuid(id) ||
    Number.isNaN(at.getTime()) ||
    (pinOrder !== null && !Number.isInteger(pinOrder))
  ) {
    throw new BadRequestError('Invalid cursor', 'INVALID_CURSOR')
  }
  return { pinOrder, at, id }
}

/** Everything that comes after `c` in the feed order: pinOrder asc (nulls last), publishedAt `order`, id `order`. */
function postsAfter(c: PostCursor, order: 'asc' | 'desc'): Prisma.PostWhereInput {
  const later = (d: Date) => (order === 'desc' ? { lt: d } : { gt: d })
  const laterId = (id: string) => (order === 'desc' ? { lt: id } : { gt: id })
  const thenByDate: Prisma.PostWhereInput = {
    OR: [{ publishedAt: later(c.at) }, { publishedAt: c.at, id: laterId(c.id) }],
  }
  // Unpinned posts sort after every pinned one, so a pinned cursor is followed by the rest of the pins, then all unpinned.
  return c.pinOrder === null
    ? { pinOrder: null, ...thenByDate }
    : { OR: [{ pinOrder: { gt: c.pinOrder } }, { pinOrder: c.pinOrder, ...thenByDate }, { pinOrder: null }] }
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
      where: { userId, communityId, isActive: true, ...notExpired(today) },
    })
    if (count === 0) {
      // Blocked by an admin is a different story from "never subscribed": say so and point them to the admin.
      await assertNotBlocked(this.db, userId, communityId, 'member')
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
    postId?: string
    communityId?: string
    communityIds?: string[]
    date?: string
    order?: 'asc' | 'desc'
    // Title or tag contains this (case-insensitive). A leading # is ignored.
    search?: string
    // "The posts after this one" (from a previous response's nextCursor). When given, `page` is ignored and no
    // totals are computed; without it the list pages by `page` as before. Either way the response has nextCursor.
    cursor?: string
    // Admin web only — adds groupReactionCounts/groupSize to each item (see PostFeedItemDTO).
    // `accessibleCommunityIds` is the admin's grant (null = every community).
    groupReactions?: { accessibleCommunityIds: string[] | null }
  }): Promise<ListPostsResponseDTO> {
    const { userId, page, pageSize, postId, communityId, communityIds, date, search, cursor, order = 'desc', groupReactions } = params
    const after = cursor ? decodePostCursor(cursor) : null
    const term = search?.trim().replace(/^#/, '')
    // Anchored to IST (+05:30), not UTC — the frontend displays/labels dates in
    // en-IN local time, so a "day" here must match what the user sees on a post
    // card, not the UTC calendar day the timestamp happens to fall on.
    const dayStart = date ? new Date(`${date}T00:00:00.000+05:30`) : undefined
    const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) : undefined

    const where: Prisma.PostWhereInput = {
      status: 'published' as const,
      deletedAt: null,
      // Combined with the community scoping below, so a scoped admin can't fetch a post outside their grant.
      ...(postId !== undefined ? { id: postId } : {}),
      ...(communityId !== undefined
        ? { communityId }
        : communityIds !== undefined
          ? { communityId: { in: communityIds } }
          : {}),
      ...(dayStart && dayEnd ? { publishedAt: { gte: dayStart, lt: dayEnd } } : {}),
      // Tags are matched whole (as typed, with or without the #), the title by substring.
      ...(term
        ? {
            OR: [
              { title: { contains: escapeLike(term), mode: 'insensitive' } },
              { tags: { hasSome: [...new Set([term, `#${term}`, term.toLowerCase(), `#${term.toLowerCase()}`])] } },
            ],
          }
        : {}),
    }

    // One extra row tells us whether anything follows, without counting. A cursor page skips the count too.
    const [fetched, total] = await Promise.all([
      this.db.post.findMany({
        where: after ? { AND: [where, postsAfter(after, order)] } : where,
        include: {
          ...VIDEO_INCLUDE,
          community: { select: { name: true, slug: true, badgeUrl: true } },
          author: { select: { name: true, avatarUrl: true } },
          _count: { select: { comments: { where: { deletedAt: null } } } },
          reactions: { where: { userId }, select: { reactionType: { select: { name: true } } }, take: 1 },
        },
        // id last, so the order is total — posts published in the same instant can't swap places between pages.
        orderBy: [{ pinOrder: { sort: 'asc', nulls: 'last' } }, { publishedAt: order }, { id: order }],
        ...(after ? {} : { skip: (page - 1) * pageSize }),
        take: pageSize + 1,
      }),
      after ? Promise.resolve(null) : this.db.post.count({ where }),
    ])

    const posts = fetched.slice(0, pageSize)
    const last = posts[posts.length - 1]
    const nextCursor =
      fetched.length > pageSize && last?.publishedAt
        ? encodePostCursor({ pinOrder: last.pinOrder, publishedAt: last.publishedAt, id: last.id })
        : null

    const groups = groupReactions ? await this.sumGroupReactions(posts, groupReactions.accessibleCommunityIds) : null

    return {
      posts: posts.map(p => {
        const reactionCounts = (p.reactionCounts as Record<string, number> | null) ?? {}
        const group = p.publishGroupId ? groups?.get(p.publishGroupId) : undefined
        return {
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
          ...toMediaShape(p),
          tags: p.tags,
          pinOrder: p.pinOrder,
          publishedAt: p.publishedAt,
          createdAt: p.createdAt,
          commentCount: p._count.comments,
          reactionCounts,
          myReaction: p.reactions[0]?.reactionType.name ?? null,
          ...(groups && {
            groupReactionCounts: group?.counts ?? reactionCounts,
            groupSize: group?.size ?? 1,
          }),
        }
      }),
      pageSize,
      nextCursor,
      ...(total === null ? {} : { total, page, totalPages: Math.max(1, Math.ceil(total / pageSize)) }),
    }
  }

  /**
   * Reactions summed over each post's publish group — the copies one publish made in several
   * communities — limited to the communities the admin can access. Keyed by publishGroupId.
   */
  private async sumGroupReactions(
    posts: { publishGroupId: string | null }[],
    accessibleCommunityIds: string[] | null,
  ): Promise<Map<string, { counts: Record<string, number>; size: number }>> {
    const groupIds = [...new Set(posts.map(p => p.publishGroupId).filter((g): g is string => g !== null))]
    const sums = new Map<string, { counts: Record<string, number>; size: number }>()
    if (groupIds.length === 0) return sums

    const members = await this.db.post.findMany({
      where: {
        publishGroupId: { in: groupIds },
        deletedAt: null,
        status: 'published',
        ...(accessibleCommunityIds !== null && { communityId: { in: accessibleCommunityIds } }),
      },
      select: { publishGroupId: true, reactionCounts: true },
    })
    for (const m of members) {
      const sum = sums.get(m.publishGroupId!) ?? { counts: {}, size: 0 }
      sum.size += 1
      for (const [type, n] of Object.entries((m.reactionCounts as Record<string, number> | null) ?? {})) {
        sum.counts[type] = (sum.counts[type] ?? 0) + n
      }
      sums.set(m.publishGroupId!, sum)
    }
    return sums
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
        ...toMediaShape(p),
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

    const images = await this.resolveImages(data.imageUrls, [], new Set())
    const videos = await this.resolveVideos(data.videos, [])

    const post = await this.db.post.create({
      data: {
        communityId: data.communityId,
        authorId: adminId,
        title: data.title,
        contentMd: data.content,
        imageUrls: data.imageUrls,
        tags: data.tags,
        images: { create: images.map((i, position) => ({ ...i, position })) },
        videos: { create: videos.map((v, position) => ({ ...v, position })) },
        ...leadShape(images, videos),
        publishGroupId: data.groupId ?? null,
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
    const post = await this.db.post.findUnique({ where: { id: postId, deletedAt: null }, include: VIDEO_INCLUDE })
    if (!post) throw new NotFoundError('Post not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, post.communityId)

    const imageUrls = data.imageUrls ?? post.imageUrls
    // Sizes are re-read from storage for anything not measured yet, so saving an old post fills them in. An old
    // image whose file can no longer be read stays on the post, just without a size.
    const images = await this.resolveImages(imageUrls, post.images, new Set(post.imageUrls))
    const videoInputs: PostVideoInput[] =
      data.videos ?? post.videos.map(v => ({ kind: v.kind, url: v.url, ...(v.title ? { title: v.title } : {}) }))
    const videos = await this.resolveVideos(videoInputs, post.videos)

    const previousVideoFiles = post.videos.filter(v => v.kind === 'file').map(v => v.url)

    const updated = await this.db.post.update({
      where: { id: postId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { contentMd: data.content }),
        ...(data.tags !== undefined && { tags: data.tags }),
        imageUrls,
        images: { deleteMany: {}, create: images.map((i, position) => ({ ...i, position })) },
        videos: { deleteMany: {}, create: videos.map((v, position) => ({ ...v, position })) },
        ...leadShape(images, videos),
      },
      include: VIDEO_INCLUDE,
    })

    // Files are removed only after the DB no longer references them — and only if no other
    // post does either (publishing to several targets makes one copy per target, all
    // pointing at the same uploaded file).
    const removed = [
      ...post.imageUrls.filter(url => !imageUrls.includes(url)),
      ...previousVideoFiles.filter(url => !videos.some(v => v.url === url)),
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
  private async resolveVideos(
    inputs: PostVideoInput[],
    existing: Array<{ url: string; width: number | null; height: number | null; durationSec: number | null; thumbnailUrl: string | null }>,
  ) {
    const seen = new Set<string>()
    const rows: Array<{
      kind: 'file' | 'youtube' | 'instagram'
      url: string
      externalId: string | null
      title: string | null
      thumbnailUrl: string | null
      width: number | null
      height: number | null
      durationSec: number | null
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
        // Size, length and poster are read from the stored file, never taken from the client. A file already
        // measured on this post is not read again.
        const known = existing.find(e => e.url === input.url && e.width && e.height)
        const probed = known ? null : await this.probeVideoFile(input.url)
        row = {
          kind: 'file',
          url: input.url,
          externalId: null,
          title: input.title ?? null,
          thumbnailUrl: known ? known.thumbnailUrl : await existingVideoPosterUrl(input.url),
          width: known?.width ?? probed?.width ?? null,
          height: known?.height ?? probed?.height ?? null,
          durationSec: known?.durationSec ?? probed?.durationSec ?? null,
        }
      } else {
        const parsed = parseVideoLink(input.url)
        if (!parsed || parsed.kind !== input.kind) {
          throw new BadRequestError(
            input.kind === 'youtube' ? 'Enter a valid YouTube video link' : 'Enter a valid Instagram post or reel link',
          )
        }
        const title = input.title ?? (parsed.kind === 'youtube' ? await fetchYoutubeTitle(parsed.canonicalUrl) : null)
        // A link's size is not known; it is stored as pasted (canonicalised) and the app picks its own layout.
        row = {
          kind: parsed.kind,
          url: parsed.canonicalUrl,
          externalId: parsed.externalId,
          title,
          thumbnailUrl: parsed.thumbnailUrl,
          width: null,
          height: null,
          durationSec: null,
        }
      }

      const key = `${row.kind}:${row.externalId ?? row.url}`
      if (seen.has(key)) throw new BadRequestError('The same video was added more than once')
      seen.add(key)
      rows.push(row)
    }
    return rows
  }

  /**
   * The real (EXIF-corrected) size of each image, read from the stored file. Images already measured on this post
   * are reused. A new image must be one of our own uploads that really decodes as JPG/PNG/WebP/GIF; an image the
   * post already had (`legacy`) whose file can no longer be read is kept without a size rather than blocking the edit.
   */
  private async resolveImages(urls: string[], existing: ImageRow[], legacy: Set<string>): Promise<ImageRow[]> {
    const rows: ImageRow[] = []
    for (const url of urls) {
      const known = existing.find(e => e.url === url)
      if (known) {
        rows.push({ url, width: known.width, height: known.height })
        continue
      }
      const buffer = await readOwnObject(url, POST_IMAGE_FOLDER, MAX_POST_IMAGE_BYTES)
      const info = buffer ? await inspectImage(buffer) : null
      if (info) {
        rows.push({ url, width: info.width, height: info.height })
      } else if (legacy.has(url)) {
        logger.warn({ url }, 'posts: could not read the size of an existing image')
      } else {
        throw new BadRequestError('An image was not found or is not a valid JPG, PNG, WebP or GIF — please upload it again')
      }
    }
    return rows
  }

  /** Size and length of an uploaded video, read by ffprobe from storage; null if it cannot be read. */
  private async probeVideoFile(url: string) {
    const readUrl = await internalReadUrl(url, VIDEO_FOLDER)
    if (!readUrl) return null
    const info = await inspectVideo(readUrl)
    if (!info) logger.warn({ url }, 'posts: could not read the size of an uploaded video')
    return info
  }

  private async deleteFileIfUnreferenced(url: string): Promise<void> {
    try {
      const [images, postImages, videos] = await Promise.all([
        this.db.post.count({ where: { imageUrls: { has: url } } }),
        this.db.postImage.count({ where: { url } }),
        this.db.postVideo.count({ where: { url } }),
      ])
      if (images + postImages + videos === 0) {
        await deleteFile(url)
        // An uploaded video's poster sits beside it, named the same with .jpg.
        if (url.includes(`/${VIDEO_FOLDER}/`) && !url.endsWith('.jpg')) await deleteFile(videoPosterUrl(url))
      }
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
    images?: ImageRow[]
    videos: VideoRow[]
    mediaWidth: number | null
    mediaHeight: number | null
    mediaRatio: number | null
    mediaOrientation: 'portrait' | 'landscape' | null
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
      ...toMediaShape(post),
      tags: post.tags,
      status: post.status,
      pinOrder: post.pinOrder,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    }
  }
}
