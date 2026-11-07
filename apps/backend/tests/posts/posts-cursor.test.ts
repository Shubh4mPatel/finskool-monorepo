import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/posts?cursor= — the admin lists scroll by cursor instead of page number. The cursor follows the feed's
// own order (pinned first, then publishedAt, then id), so walking it must give exactly the posts a single big page would.

const app = createApp()

let boss: TestAdmin
let scoped: TestAdmin // can manage Swing only
let swing: { id: string }
let options: { id: string }

const MINUTE = 60_000
const base = Date.now() - 10 * 60 * MINUTE

/** `minutes` after a fixed start, so a later number is a newer post. */
const makePost = (communityId: string, title: string, minutes: number, extra: Record<string, unknown> = {}) =>
  prisma.post.create({
    data: {
      communityId,
      authorId: boss.id,
      title,
      contentMd: 'body',
      status: 'published',
      publishedAt: new Date(base + minutes * MINUTE),
      ...extra,
    },
  })

const list = (admin: TestAdmin, query: Record<string, string>) =>
  request(app).get('/api/v1/posts').query(query).set('Authorization', admin.auth)

const titles = (res: request.Response): string[] => res.body.data.posts.map((p: { title: string }) => p.title)

/** Follows nextCursor to the end, returning every response in order. */
async function walk(admin: TestAdmin, query: Record<string, string>): Promise<request.Response[]> {
  const pages: request.Response[] = []
  let res = await list(admin, query)
  pages.push(res)
  while (res.body.data.nextCursor) {
    res = await list(admin, { ...query, cursor: res.body.data.nextCursor })
    pages.push(res)
    if (pages.length > 50) throw new Error('cursor never ended')
  }
  return pages
}

const walkTitles = async (admin: TestAdmin, query: Record<string, string>) =>
  (await walk(admin, query)).flatMap(titles)

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

describe('GET /posts?cursor=', () => {
  it('walks pinned posts first, then the rest newest-first, with nothing repeated or skipped', async () => {
    await makePost(swing.id, 'p1', 1)
    await makePost(swing.id, 'p2', 2)
    await makePost(swing.id, 'p3', 3)
    await makePost(swing.id, 'p4', 4)
    await makePost(swing.id, 'p5', 5)
    await makePost(options.id, 'pinned-b', 0, { pinOrder: 2 })
    await makePost(swing.id, 'pinned-a', 0, { pinOrder: 1 })

    const everything = titles(await list(boss, { pageSize: '50' }))
    expect(everything).toEqual(['pinned-a', 'pinned-b', 'p5', 'p4', 'p3', 'p2', 'p1'])

    // Page size 2 puts the boundary between two pins, between a pin and an unpinned post, and between unpinned ones.
    expect(await walkTitles(boss, { pageSize: '2' })).toEqual(everything)
    expect(await walkTitles(boss, { pageSize: '1' })).toEqual(everything)
    expect(await walkTitles(boss, { pageSize: '3' })).toEqual(everything)
  })

  it('walks oldest-first with order=asc', async () => {
    await makePost(swing.id, 'p1', 1)
    await makePost(swing.id, 'p2', 2)
    await makePost(swing.id, 'p3', 3)
    await makePost(swing.id, 'pinned', 0, { pinOrder: 1 })

    expect(await walkTitles(boss, { pageSize: '2', order: 'asc' })).toEqual(['pinned', 'p1', 'p2', 'p3'])
  })

  it('does not lose or repeat posts published in the same instant', async () => {
    for (const t of ['a', 'b', 'c', 'd', 'e']) await makePost(swing.id, t, 5)

    const walked = await walkTitles(boss, { pageSize: '2' })
    expect([...walked].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('gives the total on the first page only, and nextCursor null on the last', async () => {
    for (let i = 1; i <= 5; i++) await makePost(swing.id, `p${i}`, i)

    const pages = await walk(boss, { pageSize: '2' })
    expect(pages).toHaveLength(3)
    expect(pages[0]!.body.data).toMatchObject({ total: 5, page: 1, totalPages: 3 })
    expect(pages[1]!.body.data.total).toBeUndefined()
    expect(pages.map(p => titles(p).length)).toEqual([2, 2, 1])
    expect(pages[2]!.body.data.nextCursor).toBeNull()
  })

  it('has no nextCursor when everything fits on one page', async () => {
    await makePost(swing.id, 'only', 1)
    const res = await list(boss, { pageSize: '20' })
    expect(res.body.data.nextCursor).toBeNull()
  })

  it('keeps the page-number mode working, and offers a cursor from it', async () => {
    for (let i = 1; i <= 5; i++) await makePost(swing.id, `p${i}`, i)

    const second = await list(boss, { page: '2', pageSize: '2' })
    expect(titles(second)).toEqual(['p3', 'p2'])
    expect(second.body.data).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3 })

    // ...and the cursor it hands back carries on from there.
    const third = await list(boss, { pageSize: '2', cursor: second.body.data.nextCursor })
    expect(titles(third)).toEqual(['p1'])
  })

  it('keeps the other filters when scrolling: community, date', async () => {
    for (let i = 1; i <= 4; i++) await makePost(swing.id, `swing-${i}`, i)
    for (let i = 1; i <= 3; i++) await makePost(options.id, `options-${i}`, i)

    expect(await walkTitles(boss, { pageSize: '2', communityId: options.id })).toEqual(['options-3', 'options-2', 'options-1'])
  })

  it('stays inside a community admin\'s grant all the way down', async () => {
    for (let i = 1; i <= 3; i++) await makePost(swing.id, `swing-${i}`, i * 2)
    for (let i = 1; i <= 3; i++) await makePost(options.id, `options-${i}`, i * 2 + 1)

    expect(await walkTitles(scoped, { pageSize: '2' })).toEqual(['swing-3', 'swing-2', 'swing-1'])
  })

  it('rejects a cursor that is not one of ours', async () => {
    await makePost(swing.id, 'p1', 1)
    for (const bad of ['garbage', Buffer.from('x|y|z').toString('base64url'), Buffer.from('1|2026-01-01T00:00:00.000Z|not-a-uuid').toString('base64url')]) {
      const res = await list(boss, { cursor: bad })
      expect(res.status).toBe(400)
    }
  })
})

describe('GET /posts?search=', () => {
  beforeEach(async () => {
    await makePost(swing.id, 'Nifty breakout setup', 1, { tags: ['nifty'] })
    await makePost(swing.id, 'Weekly market wrap', 2, { tags: ['wrap', '#weekly'] })
    await makePost(options.id, 'NIFTY options chain', 3)
    await makePost(options.id, '100% returns?', 4)
    await makePost(options.id, 'Something else', 5)
  })

  it('matches the title, ignoring case, across every community', async () => {
    expect(titles(await list(boss, { search: 'nifty' }))).toEqual(['NIFTY options chain', 'Nifty breakout setup'])
  })

  it('matches a tag, with or without the #', async () => {
    expect(titles(await list(boss, { search: 'weekly' }))).toContain('Weekly market wrap')
    expect(titles(await list(boss, { search: '#wrap' }))).toEqual(['Weekly market wrap'])
  })

  it('treats % and _ as plain characters', async () => {
    expect(titles(await list(boss, { search: '%' }))).toEqual(['100% returns?'])
    expect(titles(await list(boss, { search: '_' }))).toEqual([])
  })

  it('is ignored when blank', async () => {
    expect(await list(boss, { search: '   ' }).then(r => r.body.data.total)).toBe(5)
  })

  it('counts only the matches, and scrolls through them by cursor', async () => {
    const pages = await walk(boss, { search: 'nifty', pageSize: '1' })
    expect(pages[0]!.body.data.total).toBe(2)
    expect(pages.flatMap(titles)).toEqual(['NIFTY options chain', 'Nifty breakout setup'])
  })

  it('combines with a community filter', async () => {
    expect(titles(await list(boss, { search: 'nifty', communityId: swing.id }))).toEqual(['Nifty breakout setup'])
  })

  it('does not reach past a community admin\'s grant', async () => {
    expect(titles(await list(scoped, { search: 'nifty' }))).toEqual(['Nifty breakout setup'])
  })
})
