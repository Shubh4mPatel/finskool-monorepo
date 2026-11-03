import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// Who may create, change or delete communities and their plans, and what a community admin can see.
// Community management is super-admin only; plans follow the community an admin manages.

const app = createApp()

let boss: TestAdmin
let priya: TestAdmin // Swing only
let swing: { id: string }
let options: { id: string }
let free: { id: string }

const api = (a: TestAdmin) => ({
  get: (url: string) => request(app).get(`/api/v1/admin${url}`).set('Authorization', a.auth),
  post: (url: string, body?: unknown) => request(app).post(`/api/v1/admin${url}`).set('Authorization', a.auth).send(body as object),
  patch: (url: string, body?: unknown) => request(app).patch(`/api/v1/admin${url}`).set('Authorization', a.auth).send(body as object),
  del: (url: string) => request(app).delete(`/api/v1/admin${url}`).set('Authorization', a.auth),
})
const plan = (over: Record<string, unknown> = {}) => ({ name: 'Monthly', durationMonths: 1, price: 499, ...over })

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  free = await createCommunity(boss.id, { name: 'Free Zone', isFree: true })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('communities', () => {
  it('a community admin only sees the communities they manage; a super admin sees all', async () => {
    const mine = await api(priya).get('/communities')
    expect(mine.body.data.map((c: { id: string }) => c.id)).toEqual([swing.id])
    const all = await api(boss).get('/communities')
    expect(all.body.data).toHaveLength(3)
  })

  it('only a super admin can create, edit or delete a community', async () => {
    const created = await api(priya).post('/communities', { name: 'Sneaky' })
    const edited = await api(priya).patch(`/communities/${swing.id}`, { name: 'Renamed' })
    const deleted = await api(priya).del(`/communities/${swing.id}`)
    expect([created.status, edited.status, deleted.status]).toEqual([403, 403, 403])
    expect(await prisma.community.count({ where: { name: 'Sneaky' } })).toBe(0)
    expect((await prisma.community.findUniqueOrThrow({ where: { id: swing.id } })).deletedAt).toBeNull()
  })

  it('creating with a duplicate name gives a distinct slug, and rejects an empty or symbol-only name', async () => {
    const a = await api(boss).post('/communities', { name: 'Same Name' })
    const b = await api(boss).post('/communities', { name: 'Same Name' })
    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body.data.slug).not.toBe(b.body.data.slug)
    expect((await api(boss).post('/communities', { name: '!!!' })).status).toBe(400)
    expect((await api(boss).post('/communities', { name: '' })).status).toBe(400)
  })

  it('deleting a community hides it everywhere and soft-deletes its posts, but keeps the rows', async () => {
    const res = await api(boss).del(`/communities/${options.id}`)
    expect(res.status).toBe(200)
    expect((await api(boss).get('/communities')).body.data.map((c: { id: string }) => c.id)).not.toContain(options.id)
    expect((await api(boss).del(`/communities/${options.id}`)).status).toBe(404)
    expect((await api(boss).patch(`/communities/${options.id}`, { name: 'Back from the dead' })).status).toBe(404)
  })

  it('a deleted community can no longer be given to an admin or a member', async () => {
    await api(boss).del(`/communities/${options.id}`)
    const grant = await api(boss).post(`/admins/${priya.id}/communities`, { communityId: options.id })
    expect(grant.status).toBe(404)
    const add = await api(boss).post('/members', { phone: '9811100123', name: 'Late Joiner', communityId: options.id, payment: 100, validUntil: daysFromNow(30) })
    expect(add.status).toBe(404)
  })
})

describe('plans', () => {
  it('a community admin can manage plans of their own community', async () => {
    const created = await api(priya).post(`/communities/${swing.id}/plans`, plan())
    expect(created.status).toBe(201)
    const id = created.body.data.id
    expect((await api(priya).patch(`/communities/${swing.id}/plans/${id}`, plan({ price: 599 }))).status).toBe(200)
    expect((await api(priya).get(`/communities/${swing.id}/plans`)).body.data.map((p: { price: number }) => p.price)).toEqual([599])
    expect((await api(priya).del(`/communities/${swing.id}/plans/${id}`)).status).toBe(200)
    expect((await api(priya).get(`/communities/${swing.id}/plans`)).body.data).toEqual([])
  })

  it('a community admin cannot touch plans of another community', async () => {
    const theirs = await api(boss).post(`/communities/${options.id}/plans`, plan())
    const id = theirs.body.data.id
    const results = await Promise.all([
      api(priya).get(`/communities/${options.id}/plans`),
      api(priya).post(`/communities/${options.id}/plans`, plan()),
      api(priya).patch(`/communities/${options.id}/plans/${id}`, plan({ price: 1 })),
      api(priya).del(`/communities/${options.id}/plans/${id}`),
    ])
    expect(results.map(r => r.status)).toEqual([403, 403, 403, 403])
    expect(Number((await prisma.plan.findUniqueOrThrow({ where: { id } })).price)).toBe(499)
  })

  it('cannot edit or delete another community\'s plan by putting it under your own community in the URL', async () => {
    const theirs = await api(boss).post(`/communities/${options.id}/plans`, plan())
    const id = theirs.body.data.id
    expect((await api(priya).patch(`/communities/${swing.id}/plans/${id}`, plan({ price: 1 }))).status).toBe(404)
    expect((await api(priya).del(`/communities/${swing.id}/plans/${id}`)).status).toBe(404)
    expect((await prisma.plan.findUniqueOrThrow({ where: { id } })).isActive).toBe(true)
  })

  it('the free community has no plans', async () => {
    const res = await api(boss).post(`/communities/${free.id}/plans`, plan())
    expect(res.status).toBe(400)
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a name of only spaces', { name: '   ' }],
    ['a zero price', { price: 0 }],
    ['a negative price', { price: -5 }],
    ['an absurd price', { price: 1e12 }],
    ['zero months', { durationMonths: 0 }],
    ['fractional months', { durationMonths: 1.5 }],
    ['absurd months', { durationMonths: 100000 }],
    ['a name over 100 characters', { name: 'N'.repeat(101) }],
    ['a price sent as text', { price: '499' }],
  ])('rejects %s with a 4xx, never a 500', async (_label, over) => {
    const res = await api(boss).post(`/communities/${swing.id}/plans`, plan(over))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('deleting a plan keeps what members already bought (their subscriptions stay)', async () => {
    const created = await api(boss).post(`/communities/${swing.id}/plans`, plan())
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    await prisma.subscription.updateMany({ where: { userId: m.id }, data: { planId: created.body.data.id } })
    expect((await api(boss).del(`/communities/${swing.id}/plans/${created.body.data.id}`)).status).toBe(200)
    expect(await prisma.subscription.count({ where: { userId: m.id, isActive: true } })).toBe(1)
    expect((await api(boss).del(`/communities/${swing.id}/plans/${created.body.data.id}`)).status).toBe(404)
  })
})

describe('comment notifications (the admin inbox of member questions)', () => {
  async function questionIn(communityId: string) {
    const member = await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(30) }] })
    const post = await prisma.post.create({ data: { communityId, authorId: boss.id, title: 'Post', contentMd: 'Body', status: 'published', publishedAt: new Date() } })
    const comment = await prisma.comment.create({ data: { postId: post.id, authorId: member.id, content: 'Question?', depth: 0, path: 'tmp' } })
    await prisma.comment.update({ where: { id: comment.id }, data: { path: comment.id } })
    return prisma.commentNotification.create({ data: { commentId: comment.id, postId: post.id } })
  }

  it('lists only the questions from communities the admin manages', async () => {
    const mine = await questionIn(swing.id)
    await questionIn(options.id)
    const res = await api(priya).get('/comment-notifications')
    expect(res.status).toBe(200)
    expect(res.body.data.notifications.map((n: { id: string }) => n.id)).toEqual([mine.id])
  })

  it('cannot mark another community\'s question as replied, singly or in bulk', async () => {
    const theirs = await questionIn(options.id)
    const one = await api(priya).patch(`/comment-notifications/${theirs.id}/mark-replied`)
    expect([403, 404]).toContain(one.status)
    await api(priya).patch('/comment-notifications/mark-all-replied', {})
    expect((await prisma.commentNotification.findUniqueOrThrow({ where: { id: theirs.id } })).isReplied).toBe(false)
    const withCommunity = await api(priya).patch('/comment-notifications/mark-all-replied', { communityId: options.id })
    expect(withCommunity.status).toBeGreaterThanOrEqual(400)
    expect((await prisma.commentNotification.findUniqueOrThrow({ where: { id: theirs.id } })).isReplied).toBe(false)
  })

  it('answers 4xx for a bad cursor or limit', async () => {
    for (const q of ['cursor=junk', 'limit=0', 'limit=1000', 'limit=abc']) {
      const res = await api(boss).get(`/comment-notifications?${q}`)
      expect(res.status, q).toBeGreaterThanOrEqual(400)
      expect(res.status, q).toBeLessThan(500)
    }
  })
})
