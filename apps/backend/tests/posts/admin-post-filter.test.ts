import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/posts?postId= — narrows the admin feed to one post (the target of a notification's "View").
// It is only ever an extra filter: community scoping still applies, so it can't reach past an admin's grant.

const app = createApp()

let boss: TestAdmin
let scoped: TestAdmin // can manage Swing only
let swing: { id: string }
let options: { id: string }

const makePost = (communityId: string, title: string, extra: Record<string, unknown> = {}) =>
  prisma.post.create({
    data: { communityId, authorId: boss.id, title, contentMd: 'body', status: 'published', publishedAt: new Date(), ...extra },
  })

const list = (admin: TestAdmin, query: Record<string, string>) =>
  request(app).get('/api/v1/posts').query(query).set('Authorization', admin.auth)

const titles = (res: request.Response) => res.body.data.posts.map((p: { title: string }) => p.title)

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /posts?postId=', () => {
  it('returns only that post', async () => {
    const wanted = await makePost(swing.id, 'Wanted')
    await makePost(swing.id, 'Noise one')
    await makePost(options.id, 'Noise two')

    const res = await list(boss, { postId: wanted.id })

    expect(res.status).toBe(200)
    expect(titles(res)).toEqual(['Wanted'])
    expect(res.body.data.total).toBe(1)
  })

  it('returns nothing for an id that matches no post', async () => {
    await makePost(swing.id, 'Something')
    const res = await list(boss, { postId: '00000000-0000-4000-8000-000000000000' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ posts: [], total: 0 })
  })

  it('does not return a deleted post or a draft', async () => {
    const deleted = await makePost(swing.id, 'Deleted', { deletedAt: new Date() })
    const draft = await makePost(swing.id, 'Draft', { status: 'draft', publishedAt: null })

    expect(titles(await list(boss, { postId: deleted.id }))).toEqual([])
    expect(titles(await list(boss, { postId: draft.id }))).toEqual([])
  })

  it('still applies the admin\'s community scope: a community admin can open a post they manage, not another', async () => {
    const mine = await makePost(swing.id, 'In Swing')
    const theirs = await makePost(options.id, 'In Options')

    expect(titles(await list(scoped, { postId: mine.id }))).toEqual(['In Swing'])
    expect(titles(await list(scoped, { postId: theirs.id }))).toEqual([])
  })

  it('combines with a community filter', async () => {
    const wanted = await makePost(swing.id, 'Wanted')
    expect(titles(await list(boss, { postId: wanted.id, communityId: swing.id }))).toEqual(['Wanted'])
    expect(titles(await list(boss, { postId: wanted.id, communityId: options.id }))).toEqual([])
  })

  it('rejects an id that is not a uuid', async () => {
    const res = await list(boss, { postId: 'abc' })
    expect(res.status).toBe(422)
  })
})
