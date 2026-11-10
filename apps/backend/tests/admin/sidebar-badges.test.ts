import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import WebSocket from 'ws'
import { createApp } from '../../src/app.js'
import redis from '../../src/lib/redis.js'
import { BADGES_PUBSUB_CHANNEL } from '../../src/lib/queue.js'
import { liveTicketsFeed } from '../../src/lib/live-tickets-feed.js'
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js'
import { AdminTicketsService } from '../../src/modules/tickets/admin-tickets.service.js'
import { AdminServicesService } from '../../src/modules/services/admin-services.service.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  createTicket,
  createServiceRequest,
  mobileCookie,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// The admin sidebar's three numbers (notifications, tickets, services) arrive over /ws/tickets: once when the socket
// connects, then whenever they may have changed, to every tab of every affected admin. No REST call, no polling.
// Redis is mocked in tests, so the events that would reach the feed over Redis are simulated by calling
// liveTicketsFeed.refreshBadgesFor(...), which is exactly what the Redis handler does.

const app = createApp()
let server: http.Server
let port = 0

interface Badges { event: string; notifications: number; tickets: number; services: number }
interface Client {
  ws: WebSocket
  messages: Badges[]
  /** Resolves with the first badges message (from `from` on) that matches, or rejects after `ms`. */
  next(pred?: (b: Badges) => boolean, ms?: number): Promise<Badges>
  /** Resolves with the messages received over `ms`. */
  quiet(ms?: number): Promise<Badges[]>
  close(): Promise<void>
}
const clients: Client[] = []
// The real counting, wrapped so a test can see whether the feed asked for it.
const computeBadges = vi.fn()

function connect(cookie: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/tickets`, { headers: { cookie } })
    const messages: Badges[] = []
    ws.on('message', d => {
      const m = JSON.parse(d.toString()) as Badges
      if (m.event === 'badges.updated') messages.push(m)
    })
    const client: Client = {
      ws,
      messages,
      async next(pred = () => true, ms = 3000) {
        const start = Date.now()
        let seen = 0
        for (;;) {
          for (; seen < messages.length; seen++) if (pred(messages[seen]!)) return messages[seen]!
          if (Date.now() - start > ms) throw new Error(`no matching badges message in ${ms}ms; got ${JSON.stringify(messages)}`)
          await new Promise(r => setTimeout(r, 25))
        }
      },
      async quiet(ms = 700) {
        const before = messages.length
        await new Promise(r => setTimeout(r, ms))
        return messages.slice(before)
      },
      close: () =>
        new Promise<void>(res => {
          if (ws.readyState === WebSocket.CLOSED) return res()
          ws.once('close', () => res())
          ws.close()
        }),
    }
    ws.once('open', () => { clients.push(client); resolve(client) })
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)))
    ws.once('error', reject)
  })
}

const tokenCookie = (admin: TestAdmin) => `access_token=${admin.auth.replace('Bearer ', '')}`
const counts = (b: Badges) => ({ notifications: b.notifications, tickets: b.tickets, services: b.services })

let superA: TestAdmin
let superB: TestAdmin
let swing: { id: string }
let options: { id: string }
let member: TestMobileMember

const notify = (userId: string, communityId: string | null = swing.id) =>
  prisma.notification.create({
    data: { userId, communityId, type: 'new-member-registered', sourceId: randomUUID(), title: 'Someone joined', message: 'details' },
  })

beforeAll(async () => {
  const notifications = new NotificationsService(prisma)
  const tickets = new AdminTicketsService(prisma)
  const services = new AdminServicesService(prisma)
  server = http.createServer(app)
  computeBadges.mockImplementation(async viewer => {
    const [n, t, s] = await Promise.all([notifications.unreadCount(viewer.id), tickets.badgeCount(viewer), services.badgeCount()])
    return { notifications: n, tickets: t, services: s }
  })
  liveTicketsFeed.attach(server, undefined, { subscribe: false, computeBadges })
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res))
  port = (server.address() as AddressInfo).port
})

beforeEach(async () => {
  await resetDb()
  vi.mocked(redis.publish).mockClear()
  superA = await createAdmin({ isSuperAdmin: true })
  superB = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(superA.id, { name: 'Swing Traders' })
  options = await createCommunity(superA.id, { name: 'Options Club' })
  member = await createMobileMember()
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close()))
})

afterAll(async () => {
  await new Promise<void>(res => server.close(() => res()))
  await prisma.$disconnect()
})

describe('the snapshot an admin gets when the sidebar connects', () => {
  it('carries all three numbers, so no REST call is needed', async () => {
    await notify(superA.id)
    await notify(superA.id)
    await createTicket({ userId: member.id, communityId: swing.id }) // unassigned
    await createServiceRequest({ userId: member.id }) // unassigned

    const a = await connect(tokenCookie(superA))
    expect(counts(await a.next())).toEqual({ notifications: 2, tickets: 1, services: 1 })
  })

  it('is per admin: notifications are theirs, an unassigned ticket is everyone\'s', async () => {
    await notify(superA.id)
    await createTicket({ userId: member.id, communityId: swing.id })

    const [a, b] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superB))]
    expect(counts(await a.next())).toMatchObject({ notifications: 1, tickets: 1 })
    expect(counts(await b.next())).toMatchObject({ notifications: 0, tickets: 1 })
  })

  it('counts only the unassigned ones, for tickets and for enquiries: what an admin has taken adds nothing', async () => {
    // A ticket that A has taken, with unread member messages, is not "waiting for someone": it adds nothing.
    const t = await createTicket({ userId: member.id, communityId: swing.id, status: 'in_progress' })
    await prisma.ticket.update({ where: { id: t.id }, data: { assignedAdminId: superA.id, adminUnreadCount: 3 } })
    await createTicket({ userId: member.id, communityId: swing.id }) // nobody has taken this one
    // An enquiry that A has taken, with an unread member message, is not "waiting for someone": it adds nothing.
    const taken = await createServiceRequest({ userId: member.id })
    await prisma.serviceRequest.update({ where: { id: taken.id }, data: { assignedAdminId: superA.id, adminUnreadCount: 1 } })
    // One nobody has taken is.
    await createServiceRequest({ userId: member.id })

    const [a, b] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superB))]
    expect(counts(await a.next())).toMatchObject({ tickets: 1, services: 1 })
    expect(counts(await b.next())).toMatchObject({ tickets: 1, services: 1 })
  })

  it('does not add payments that need review to the enquiries number', async () => {
    const r = await createServiceRequest({ userId: member.id, status: 'paid' })
    await prisma.serviceRequest.update({ where: { id: r.id }, data: { assignedAdminId: superA.id, requiresReview: true } })

    const [a, b] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superB))]
    expect((await a.next()).services).toBe(0)
    expect((await b.next()).services).toBe(0)
  })

  it('does not count closed enquiries, even unassigned ones', async () => {
    await createServiceRequest({ userId: member.id, status: 'closed' })
    await createServiceRequest({ userId: member.id })

    const a = await connect(tokenCookie(superA))
    expect((await a.next()).services).toBe(1)
  })

  it('counts only the communities a scoped admin manages', async () => {
    await createTicket({ userId: member.id, communityId: swing.id })
    const other = await createMobileMember()
    await createTicket({ userId: other.id, communityId: options.id })
    const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })

    const [s, all] = [await connect(tokenCookie(scoped)), await connect(tokenCookie(superA))]
    expect((await s.next()).tickets).toBe(1)
    expect((await all.next()).tickets).toBe(2)
  })

  it('counts a notification that belongs to no community as well as one that does', async () => {
    await notify(superA.id, null) // no community: always visible
    await notify(superA.id)
    const a = await connect(tokenCookie(superA))
    expect((await a.next()).notifications).toBe(2)
  })
})

describe('pushes after the snapshot', () => {
  it('sends the new numbers when something changed, to every tab of that admin', async () => {
    const n = await notify(superA.id)
    await notify(superA.id)
    const [tab1, tab2] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superA))]
    await tab1.next()
    await tab2.next()

    await prisma.notification.update({ where: { id: n.id }, data: { isRead: true } })
    liveTicketsFeed.refreshBadgesFor([superA.id])

    expect((await tab1.next(b => b.notifications === 1)).notifications).toBe(1)
    expect((await tab2.next(b => b.notifications === 1)).notifications).toBe(1)
  })

  it('tells every other admin when a shared item is taken, without them doing anything', async () => {
    const t = await createTicket({ userId: member.id, communityId: swing.id })
    const [a, b] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superB))]
    expect((await a.next()).tickets).toBe(1)
    expect((await b.next()).tickets).toBe(1)

    // Admin A takes the ticket: the shared "unassigned" count drops for B, and A's own tab keeps seeing it as theirs.
    await prisma.ticket.update({ where: { id: t.id }, data: { assignedAdminId: superA.id, status: 'in_progress' } })
    liveTicketsFeed.refreshBadgesFor([superA.id, superB.id])

    expect((await b.next(x => x.tickets === 0)).tickets).toBe(0)
    // A's number is its own: nothing unassigned, nothing unread, so it is 0 too.
    expect((await a.next(x => x.tickets === 0)).tickets).toBe(0)
  })

  it('raises every admin\'s number when a new ticket arrives, and nobody\'s when a member writes on a ticket someone has taken', async () => {
    const taken = await createTicket({ userId: member.id, communityId: swing.id, status: 'in_progress' })
    await prisma.ticket.update({ where: { id: taken.id }, data: { assignedAdminId: superA.id } })
    const [a, b] = [await connect(tokenCookie(superA)), await connect(tokenCookie(superB))]
    expect((await a.next()).tickets).toBe(0)
    expect((await b.next()).tickets).toBe(0)

    // A member writes on the ticket A has taken: it is A's to answer, not waiting for anyone, so no number moves.
    await prisma.ticket.update({ where: { id: taken.id }, data: { adminUnreadCount: 1 } })
    liveTicketsFeed.refreshBadgesFor([superA.id, superB.id])
    expect(await a.quiet()).toEqual([])
    expect(await b.quiet(100)).toEqual([])

    // A new ticket nobody has taken does move them, for every admin.
    await createTicket({ userId: (await createMobileMember()).id, communityId: swing.id })
    liveTicketsFeed.refreshBadgesFor([superA.id, superB.id])
    expect((await a.next(x => x.tickets === 1)).tickets).toBe(1)
    expect((await b.next(x => x.tickets === 1)).tickets).toBe(1)
  })

  it('merges a burst of events into one push', async () => {
    const a = await connect(tokenCookie(superA))
    await a.next()
    await notify(superA.id)

    for (let i = 0; i < 6; i++) liveTicketsFeed.refreshBadgesFor([superA.id])

    const pushed = await a.quiet(900)
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.notifications).toBe(1)
  })

  it('sends nothing when the numbers did not change', async () => {
    const a = await connect(tokenCookie(superA))
    await a.next()

    liveTicketsFeed.refreshBadgesFor([superA.id])
    expect(await a.quiet(800)).toEqual([])
  })

  it('a socket that connects later gets the current numbers, not the old ones', async () => {
    const first = await connect(tokenCookie(superA))
    await first.next()
    await notify(superA.id)
    liveTicketsFeed.refreshBadgesFor([superA.id])
    await first.next(b => b.notifications === 1)

    const second = await connect(tokenCookie(superA))
    expect((await second.next()).notifications).toBe(1)
  })
})

describe('who gets nothing', () => {
  it('a member\'s mobile socket never receives sidebar badges', async () => {
    await notify(superA.id)
    const m = await connect(mobileCookie(member))
    liveTicketsFeed.refreshBadgesFor([member.id])

    expect(await m.quiet(900)).toEqual([])
  })

  it('an admin with no dashboard open costs no query (refreshing them is a no-op)', async () => {
    computeBadges.mockClear()
    liveTicketsFeed.refreshBadgesFor([superB.id])
    await new Promise(r => setTimeout(r, 500))

    expect(computeBadges).not.toHaveBeenCalled()
  })

  it('a refresh arriving after the last tab closed does not push or throw', async () => {
    const a = await connect(tokenCookie(superA))
    await a.next()
    await a.close()

    expect(() => liveTicketsFeed.refreshBadgesFor([superA.id])).not.toThrow()
    await new Promise(r => setTimeout(r, 500))
  })
})

describe('reading notifications reaches the admin\'s other tabs', () => {
  it('marking one read asks the feed to refresh that admin', async () => {
    const n = await notify(superA.id)

    const res = await request(app).patch(`/api/v1/notifications/${n.id}/read`).set('Authorization', superA.auth).send({})

    expect(res.status).toBe(200)
    expect(vi.mocked(redis.publish)).toHaveBeenCalledWith(BADGES_PUBSUB_CHANNEL, JSON.stringify({ userIds: [superA.id] }))
  })

  it('marking all read asks the feed to refresh that admin', async () => {
    await notify(superA.id)
    await notify(superA.id)

    const res = await request(app).patch('/api/v1/notifications/mark-all-read').set('Authorization', superA.auth).send({})

    expect(res.status).toBe(200)
    expect(vi.mocked(redis.publish)).toHaveBeenCalledWith(BADGES_PUBSUB_CHANNEL, JSON.stringify({ userIds: [superA.id] }))
  })

  it('and the other tab\'s badge follows', async () => {
    const n = await notify(superA.id)
    await notify(superA.id)
    const otherTab = await connect(tokenCookie(superA))
    expect((await otherTab.next()).notifications).toBe(2)

    await request(app).patch(`/api/v1/notifications/${n.id}/read`).set('Authorization', superA.auth).send({})
    liveTicketsFeed.refreshBadgesFor([superA.id]) // what the Redis message the call above published causes

    expect((await otherTab.next(b => b.notifications === 1)).notifications).toBe(1)
  })
})
