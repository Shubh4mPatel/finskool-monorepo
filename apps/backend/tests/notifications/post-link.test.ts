import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/notifications — a reaction or reply notification only stores the reaction's / comment's id,
// so the list works out which post it is about and returns it as routing `data`: { type: 'post', id }.
// That is what the admin "View" button follows to the post.

const app = createApp()

let admin: TestAdmin
let community: { id: string }
let post: { id: string }
let member: { id: string }

const list = () => request(app).get('/api/v1/notifications').set('Authorization', admin.auth)
const itemFor = (res: request.Response, notificationId: string) =>
  res.body.data.notifications.find((n: { id: string }) => n.id === notificationId)

function notify(type: string, sourceId: string, data?: Record<string, string>) {
  return prisma.notification.create({
    data: {
      userId: admin.id,
      communityId: community.id,
      type,
      sourceId,
      title: 'Something happened',
      message: 'details',
      ...(data ? { data } : {}),
    },
  })
}

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  community = await createCommunity(admin.id)
  member = await createMobileMember()
  post = await prisma.post.create({
    data: { communityId: community.id, authorId: admin.id, title: 'Level Expand', contentMd: 'body', status: 'published', publishedAt: new Date() },
  })
  await prisma.reactionType.create({ data: { id: 1, name: 'like', emoji: '👍', sortOrder: 1 } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /notifications — which post a notification is about', () => {
  it('points a reaction notification at the reacted-to post', async () => {
    const reaction = await prisma.reaction.create({ data: { postId: post.id, userId: member.id, reactionTypeId: 1 } })
    const n = await notify('reaction', reaction.id)

    const res = await list()

    expect(res.status).toBe(200)
    expect(itemFor(res, n.id).data).toEqual({ type: 'post', id: post.id })
  })

  it.each(['thread', 'new-member-reply'])('points a %s notification at the post the comment is on', async type => {
    const comment = await prisma.comment.create({
      data: { postId: post.id, authorId: member.id, content: 'Great post', path: 'x' },
    })
    const n = await notify(type, comment.id)

    const res = await list()
    expect(itemFor(res, n.id).data).toEqual({ type: 'post', id: post.id })
  })

  it('works out several at once, each to its own post', async () => {
    const other = await prisma.post.create({
      data: { communityId: community.id, authorId: admin.id, title: 'Other', contentMd: 'b', status: 'published', publishedAt: new Date() },
    })
    const r1 = await prisma.reaction.create({ data: { postId: post.id, userId: member.id, reactionTypeId: 1 } })
    const second = await createMobileMember()
    const r2 = await prisma.reaction.create({ data: { postId: other.id, userId: second.id, reactionTypeId: 1 } })
    const n1 = await notify('reaction', r1.id)
    const n2 = await notify('reaction', r2.id)

    const res = await list()
    expect(itemFor(res, n1.id).data.id).toBe(post.id)
    expect(itemFor(res, n2.id).data.id).toBe(other.id)
  })

  it('leaves data null when the reaction is gone — the post was deleted', async () => {
    const reaction = await prisma.reaction.create({ data: { postId: post.id, userId: member.id, reactionTypeId: 1 } })
    const n = await notify('reaction', reaction.id)
    await prisma.post.delete({ where: { id: post.id } }) // cascades to the reaction

    const res = await list()
    expect(itemFor(res, n.id).data).toBeNull()
  })

  it('does not touch a notification that already has routing data, or one that is not about a post', async () => {
    const reaction = await prisma.reaction.create({ data: { postId: post.id, userId: member.id, reactionTypeId: 1 } })
    const own = await notify('reaction', reaction.id, { type: 'custom', id: 'keep-me' })
    const unrelated = await notify('import-complete', reaction.id)

    const res = await list()
    expect(itemFor(res, own.id).data).toEqual({ type: 'custom', id: 'keep-me' })
    expect(itemFor(res, unrelated.id).data).toBeNull()
  })
})
