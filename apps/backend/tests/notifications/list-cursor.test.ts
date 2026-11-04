import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/notifications?pageSize=&cursor= — the admin Notifications screen loads another batch each time the
// end of the list scrolls into view, by following `nextCursor`. The batches must join up exactly: every
// notification once, newest first, whatever arrives while the admin is scrolling.

const app = createApp()

let admin: TestAdmin
let community: { id: string }

const list = (query: Record<string, string> = {}) =>
  request(app).get('/api/v1/notifications').query(query).set('Authorization', admin.auth)

/** `count` notifications, one a minute apart; the oldest is number 1, so the newest-first order is count..1. */
async function seed(count: number, startMinute = 0) {
  for (let i = 1; i <= count; i++) {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        communityId: community.id,
        type: 'new_member',
        sourceId: randomUUID(),
        title: `Notification ${startMinute + i}`,
        message: 'details',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, startMinute + i)),
      },
    })
  }
}

const titles = (res: request.Response) => res.body.data.notifications.map((n: { title: string }) => n.title)

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  community = await createCommunity(admin.id)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('scrolling through the notifications', () => {
  it('the first batch comes with the cursor to the next one', async () => {
    await seed(45)
    const res = await list({ pageSize: '20' })
    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toHaveLength(20)
    expect(titles(res)[0]).toBe('Notification 45')
    expect(res.body.data.nextCursor).toEqual(expect.any(String))
  })

  it('following the cursor shows every notification once, newest first, and ends with no cursor', async () => {
    await seed(45)
    const seen: string[] = []
    const sizes: number[] = []
    let cursor: string | null = null
    do {
      const res: request.Response = await list({ pageSize: '20', ...(cursor ? { cursor } : {}) })
      expect(res.status).toBe(200)
      sizes.push(res.body.data.notifications.length)
      seen.push(...titles(res))
      cursor = res.body.data.nextCursor
    } while (cursor)

    expect(sizes).toEqual([20, 20, 5])
    expect(seen).toHaveLength(45)
    expect(new Set(seen).size).toBe(45)
    expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => `Notification ${45 - i}`))
  })

  it('a batch that exactly fills the last page has no cursor after it', async () => {
    await seed(40)
    const first = await list({ pageSize: '20' })
    const second = await list({ pageSize: '20', cursor: first.body.data.nextCursor })
    expect(second.body.data.notifications).toHaveLength(20)
    expect(second.body.data.nextCursor).toBeNull()
  })

  it('a short list is one batch with no cursor', async () => {
    await seed(7)
    const res = await list({ pageSize: '20' })
    expect(res.body.data.notifications).toHaveLength(7)
    expect(res.body.data.nextCursor).toBeNull()
  })

  it('notifications that arrive while scrolling do not repeat or push anything out of the next batch', async () => {
    await seed(30)
    const first = await list({ pageSize: '20' })
    expect(titles(first)[0]).toBe('Notification 30')

    // Five new ones land after the first batch was read. They are newer than everything on screen, so the older
    // ones the cursor leads to are exactly the ones still to come.
    await seed(5, 100)
    const second = await list({ pageSize: '20', cursor: first.body.data.nextCursor })
    expect(titles(second)).toEqual(Array.from({ length: 10 }, (_, i) => `Notification ${10 - i}`))
    expect(second.body.data.nextCursor).toBeNull()
  })

  it('only ever lists the caller\'s own notifications', async () => {
    await seed(3)
    const other = await createAdmin()
    await prisma.notification.create({
      data: { userId: other.id, communityId: community.id, type: 'new_member', sourceId: randomUUID(), title: 'Not yours', message: 'x' },
    })
    expect(titles(await list({ pageSize: '20' }))).not.toContain('Not yours')
  })

  it('rejects a cursor that is not one we gave out', async () => {
    const res = await list({ pageSize: '20', cursor: 'garbage' })
    expect(res.status).toBe(400)
  })
})
