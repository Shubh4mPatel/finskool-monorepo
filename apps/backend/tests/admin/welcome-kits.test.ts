import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  mobileCookie,
  daysFromNow,
  type TestAdmin,
} from '../helpers/fixtures.js'

// GET /api/v1/admin/welcome-kits?status=all|ready|pending — the welcome-kit list page's tabs.
// Filtering happens on the server; `counts` always covers every community the admin can manage.

const app = createApp()

let superAdmin: TestAdmin
let alpha: { id: string }
let beta: { id: string }
let gamma: { id: string }

const list = (admin: TestAdmin, query: Record<string, string> = {}) =>
  request(app).get('/api/v1/admin/welcome-kits').query(query).set('Authorization', admin.auth)

const names = (res: request.Response) => res.body.data.items.map((c: { name: string }) => c.name)

beforeEach(async () => {
  await resetDb()
  superAdmin = await createAdmin({ isSuperAdmin: true })
  // Created out of order on purpose — the list is alphabetical.
  gamma = await createCommunity(superAdmin.id, { name: 'Gamma Options' })
  alpha = await createCommunity(superAdmin.id, { name: 'Alpha Swing' })
  beta = await createCommunity(superAdmin.id, { name: 'Beta Investors' })
  await createCommunity(superAdmin.id, { name: 'Finskool Free', isFree: true }) // never listed
  const gone = await createCommunity(superAdmin.id, { name: 'Deleted Club' }) // never listed
  await prisma.community.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })

  // Alpha has a real kit; Beta has a kit row with every section empty (still "pending"); Gamma has none.
  await prisma.communityKit.create({
    data: { communityId: alpha.id, watchBeforeYouStart: { introMarkdown: 'Welcome!', youtubeUrls: [] } },
  })
  await prisma.communityKit.create({ data: { communityId: beta.id } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /admin/welcome-kits', () => {
  it('lists every live paid community, alphabetically, with totals per status', async () => {
    const res = await list(superAdmin)

    expect(res.status).toBe(200)
    expect(names(res)).toEqual(['Alpha Swing', 'Beta Investors', 'Gamma Options'])
    expect(res.body.data.counts).toEqual({ all: 3, ready: 1, pending: 2 })
    expect(res.body.data.items[0]).toMatchObject({ communityId: alpha.id, hasKit: true, updatedAt: expect.any(String) })
    expect(res.body.data.items[1]).toMatchObject({ communityId: beta.id, hasKit: false, updatedAt: null })
  })

  it('status=all behaves like no status', async () => {
    const res = await list(superAdmin, { status: 'all' })
    expect(names(res)).toEqual(['Alpha Swing', 'Beta Investors', 'Gamma Options'])
  })

  it('status=ready returns only communities whose kit has content', async () => {
    const res = await list(superAdmin, { status: 'ready' })

    expect(names(res)).toEqual(['Alpha Swing'])
    // Totals don't change with the filter — the tabs need all three.
    expect(res.body.data.counts).toEqual({ all: 3, ready: 1, pending: 2 })
  })

  it('status=pending includes a kit row whose sections are all empty', async () => {
    const res = await list(superAdmin, { status: 'pending' })
    expect(names(res)).toEqual(['Beta Investors', 'Gamma Options'])
  })

  it('moves a community from pending to ready once its kit is published', async () => {
    const put = await request(app)
      .put(`/api/v1/admin/communities/${gamma.id}/welcome-kit`)
      .set('Authorization', superAdmin.auth)
      .send({ whatYouGet: [{ text: 'Daily trade ideas' }] })
    expect(put.status).toBe(200)

    expect(names(await list(superAdmin, { status: 'ready' }))).toEqual(['Alpha Swing', 'Gamma Options'])
    expect((await list(superAdmin)).body.data.counts).toEqual({ all: 3, ready: 2, pending: 1 })
  })

  it('scopes a community admin, items and counts alike', async () => {
    const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [alpha.id, gamma.id] })

    const all = await list(scoped)
    expect(names(all)).toEqual(['Alpha Swing', 'Gamma Options'])
    expect(all.body.data.counts).toEqual({ all: 2, ready: 1, pending: 1 })

    expect(names(await list(scoped, { status: 'pending' }))).toEqual(['Gamma Options'])
  })

  it('returns nothing for an admin who manages no communities', async () => {
    const nobody = await createAdmin({ isSuperAdmin: false, communityIds: [] })
    const res = await list(nobody)
    expect(res.body.data).toEqual({ items: [], counts: { all: 0, ready: 0, pending: 0 } })
  })

  it.each(['done', 'READY', ''])('rejects status=%j', async status => {
    const res = await list(superAdmin, { status })
    expect(res.status).toBe(422)
  })

  it('rejects unauthenticated requests and mobile members', async () => {
    expect((await request(app).get('/api/v1/admin/welcome-kits')).status).toBe(401)

    const member = await createMobileMember({ subscriptions: [{ communityId: alpha.id, validUntil: daysFromNow(30) }] })
    const res = await request(app).get('/api/v1/admin/welcome-kits').set('Cookie', mobileCookie(member))
    expect(res.status).toBe(403)
  })
})
