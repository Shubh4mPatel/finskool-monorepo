import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/notifications?unreadFirst=true — the admin Notifications page. Every unread notification comes before
// the read ones, each group newest to oldest, so the "New" section is the whole unread list and its count matches
// the unread badge. Without the flag (the mobile app) the order is unchanged: newest first, read or not.

const app = createApp()

let admin: TestAdmin
let community: { id: string }

const list = (query: Record<string, string | number> = {}) =>
  request(app).get('/api/v1/notifications').query(query).set('Authorization', admin.auth)

const minute = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n))

/** One notification at `minuteOffset`, titled `<R|U><minuteOffset>` so an order is easy to read. */
async function seed(minuteOffset: number, isRead: boolean, communityId: string | null = community.id) {
  return prisma.notification.create({
    data: {
      userId: admin.id,
      communityId,
      type: 'new_member',
      sourceId: randomUUID(),
      title: `${isRead ? 'R' : 'U'}${minuteOffset}`,
      message: 'details',
      isRead,
      createdAt: minute(minuteOffset),
    },
  })
}

const titles = (res: request.Response) => res.body.data.notifications.map((n: { title: string }) => n.title)

/** Follows nextCursor to the end, returning every title in the order served. */
async function readAll(query: Record<string, string | number>): Promise<string[]> {
  const out: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 50; i++) {
    const res: request.Response = await list({ ...query, ...(cursor ? { cursor } : {}) })
    expect(res.status).toBe(200)
    out.push(...titles(res))
    cursor = res.body.data.nextCursor
    if (!cursor) return out
  }
  throw new Error('paging never ended')
}

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  community = await createCommunity(admin.id)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('unreadFirst=true', () => {
  it('puts every unread notification first, then the read ones, each newest to oldest', async () => {
    // Read ones are newer than some unread ones, so a plain newest-first list would interleave them.
    await seed(10, true)
    await seed(9, false)
    await seed(8, true)
    await seed(7, false)
    await seed(6, true)
    await seed(5, false)

    const res = await list({ unreadFirst: 'true' })

    expect(titles(res)).toEqual(['U9', 'U7', 'U5', 'R10', 'R8', 'R6'])
  })

  it('leaves the default order alone, so the mobile app is not affected', async () => {
    await seed(10, true)
    await seed(9, false)
    await seed(8, true)
    await seed(7, false)

    expect(titles(await list())).toEqual(['R10', 'U9', 'R8', 'U7'])
    expect(titles(await list({ unreadFirst: 'false' }))).toEqual(['R10', 'U9', 'R8', 'U7'])
  })

  it('puts all 8 unread in the first batch even when 20 newer notifications are already read', async () => {
    // The page the admin saw: 8 unread, older than a pile of read ones. "New" must show all 8, not just a few.
    for (let i = 1; i <= 8; i++) await seed(i, false)
    for (let i = 30; i < 50; i++) await seed(i, true)

    const res = await list({ unreadFirst: 'true', pageSize: 20 })
    const first = res.body.data.notifications as { title: string; isRead: boolean }[]

    expect(first.filter(n => !n.isRead)).toHaveLength(8)
    expect(first.slice(0, 8).map(n => n.title)).toEqual(['U8', 'U7', 'U6', 'U5', 'U4', 'U3', 'U2', 'U1'])
    expect(first.slice(8).every(n => n.isRead)).toBe(true)
    // ...and that is the same number the sidebar badge shows.
    const unread = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', admin.auth)
    expect(unread.body.data.count).toBe(8)
  })

  it('pages by cursor across the unread/read boundary without repeating or skipping anything', async () => {
    for (let i = 1; i <= 7; i++) await seed(i, i % 2 === 0) // U1 U3 U5 U7 are unread, R2 R4 R6 are read
    await seed(20, false)
    await seed(21, true)

    const expected = ['U20', 'U7', 'U5', 'U3', 'U1', 'R21', 'R6', 'R4', 'R2']
    for (const pageSize of [1, 2, 3, 4, 5, 9, 20]) {
      expect(await readAll({ unreadFirst: 'true', pageSize })).toEqual(expected)
    }
  })

  it('breaks ties on identical timestamps by id, so the order is total', async () => {
    for (let i = 0; i < 4; i++) await seed(5, false)
    for (let i = 0; i < 4; i++) await seed(5, true)

    const all = await readAll({ unreadFirst: 'true', pageSize: 3 })

    expect(all).toHaveLength(8)
    expect(new Set(all).size).toBe(2) // only two distinct titles, U5 x4 then R5 x4, none dropped or doubled
    expect(all.slice(0, 4).every(t => t === 'U5')).toBe(true)
    expect(all.slice(4).every(t => t === 'R5')).toBe(true)
  })

  it('works with page numbers too, the website\'s way of paging', async () => {
    for (let i = 1; i <= 3; i++) await seed(i, false)
    for (let i = 10; i <= 12; i++) await seed(i, true)

    const page1 = await list({ unreadFirst: 'true', pageSize: 4, page: 1 })
    const page2 = await list({ unreadFirst: 'true', pageSize: 4, page: 2 })

    expect(titles(page1)).toEqual(['U3', 'U2', 'U1', 'R12'])
    expect(titles(page2)).toEqual(['R11', 'R10'])
    expect(page1.body.data.total).toBe(6)
  })

  it('still hides notifications and counts only what the admin may see', async () => {
    await seed(3, false)
    await seed(2, false, null) // a notification with no community is always visible
    await seed(1, true)

    expect(await readAll({ unreadFirst: 'true', pageSize: 2 })).toEqual(['U3', 'U2', 'R1'])
  })

  it('refuses a cursor that is not one of its own', async () => {
    await seed(1, false)
    const res = await list({ unreadFirst: 'true', cursor: 'garbage' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_CURSOR')
  })

  it('refuses an unread-first cursor handed to the default listing', async () => {
    for (let i = 1; i <= 3; i++) await seed(i, false)
    const first = await list({ unreadFirst: 'true', pageSize: 1 })
    const cursor = first.body.data.nextCursor as string

    const res = await list({ pageSize: 1, cursor })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_CURSOR')
  })
})
