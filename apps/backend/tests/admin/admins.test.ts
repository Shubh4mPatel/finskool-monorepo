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

// GET /api/v1/admin/admins?role=all|super|scoped&search=&communityId= — the Roles & Admins page.
// Filtering and the tab counts come from the server. `counts` honour search and community but ignore
// `role`, so each tab's number is what that tab lists.

const app = createApp()

let boss: TestAdmin // super admin: "Zoya Boss"
let swing: { id: string }
let options: { id: string }
let priya: TestAdmin // scoped to Swing
let omar: TestAdmin // scoped to Options
let both: TestAdmin // scoped to both

const list = (admin: TestAdmin, query: Record<string, string> = {}) =>
  request(app).get('/api/v1/admin/admins').query(query).set('Authorization', admin.auth)

const names = (res: request.Response) => res.body.data.items.map((a: { name: string }) => a.name)

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true, name: 'Zoya Boss', email: 'zoya@finskool.test' })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id], name: 'Priya Shah', email: 'priya@finskool.test' })
  omar = await createAdmin({ isSuperAdmin: false, communityIds: [options.id], name: 'Omar Khan', email: 'omar.k@example.org' })
  both = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id, options.id], name: 'Anita Rao', email: 'anita@finskool.test' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /admin/admins', () => {
  it('lists every admin alphabetically, with each one\'s communities and totals per role', async () => {
    const res = await list(boss)

    expect(res.status).toBe(200)
    expect(names(res)).toEqual(['Anita Rao', 'Omar Khan', 'Priya Shah', 'Zoya Boss'])
    expect(res.body.data.counts).toEqual({ all: 4, super: 1, scoped: 3 })

    const byName = Object.fromEntries(res.body.data.items.map((a: { name: string }) => [a.name, a]))
    expect(byName['Zoya Boss']).toMatchObject({ isSuperAdmin: true, email: 'zoya@finskool.test', communityAccess: [] })
    expect(byName['Priya Shah'].communityAccess).toEqual([{ id: swing.id, name: expect.any(String), slug: expect.any(String) }])
    expect(byName['Anita Rao'].communityAccess).toHaveLength(2)
  })

  it('never lists mobile members or deleted admins', async () => {
    await createMobileMember({ name: 'Mobile Mia' })
    const gone = await createAdmin({ isSuperAdmin: false, name: 'Gone Gary' })
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })

    const res = await list(boss)
    expect(names(res)).not.toContain('Mobile Mia')
    expect(names(res)).not.toContain('Gone Gary')
    expect(res.body.data.counts.all).toBe(4)
  })

  describe('role', () => {
    it('role=super lists only super admins', async () => {
      const res = await list(boss, { role: 'super' })
      expect(names(res)).toEqual(['Zoya Boss'])
    })

    it('role=scoped lists only community-scoped admins', async () => {
      const res = await list(boss, { role: 'scoped' })
      expect(names(res)).toEqual(['Anita Rao', 'Omar Khan', 'Priya Shah'])
    })

    it('does not change the counts — every tab needs its number', async () => {
      const all = (await list(boss)).body.data.counts
      expect((await list(boss, { role: 'super' })).body.data.counts).toEqual(all)
      expect((await list(boss, { role: 'scoped' })).body.data.counts).toEqual(all)
    })
  })

  describe('search', () => {
    it.each([
      ['name, case-insensitive', 'pRiYa', ['Priya Shah']],
      ['part of a name', 'rao', ['Anita Rao']],
      ['email', 'omar.k@', ['Omar Khan']],
      ['an email domain', 'example.org', ['Omar Khan']],
      ['whitespace around the term', '  anita  ', ['Anita Rao']],
    ])('matches by %s', async (_label, search, expected) => {
      expect(names(await list(boss, { search }))).toEqual(expected)
    })

    it('counts only what matches the search, per role', async () => {
      const res = await list(boss, { search: 'finskool.test' })
      // zoya, priya and anita use @finskool.test; omar doesn't.
      expect(res.body.data.counts).toEqual({ all: 3, super: 1, scoped: 2 })
    })

    it('returns nothing, with zero counts, when nobody matches', async () => {
      const res = await list(boss, { search: 'nobody-called-this' })
      expect(res.body.data).toEqual({ items: [], counts: { all: 0, super: 0, scoped: 0 } })
    })

    it('treats % and _ as plain characters, not wildcards', async () => {
      expect(names(await list(boss, { search: '%' }))).toEqual([])
      expect(names(await list(boss, { search: 'o_ar' }))).toEqual([])
    })
  })

  describe('communityId', () => {
    it('lists admins who can manage that community — scoped ones with access, plus every super admin', async () => {
      expect(names(await list(boss, { communityId: swing.id }))).toEqual(['Anita Rao', 'Priya Shah', 'Zoya Boss'])
      expect(names(await list(boss, { communityId: options.id }))).toEqual(['Anita Rao', 'Omar Khan', 'Zoya Boss'])
    })

    it('counts per role within that community', async () => {
      const res = await list(boss, { communityId: swing.id })
      expect(res.body.data.counts).toEqual({ all: 3, super: 1, scoped: 2 })
    })

    it('still lists a community nobody is scoped to — super admins can manage it', async () => {
      const empty = await createCommunity(boss.id, { name: 'Brand New' })
      const res = await list(boss, { communityId: empty.id })
      expect(names(res)).toEqual(['Zoya Boss'])
    })
  })

  it('combines role, search and community', async () => {
    const res = await list(boss, { role: 'scoped', communityId: options.id, search: 'a' })
    // scoped + can manage Options + name/email contains "a": Anita Rao, Omar Khan.
    expect(names(res)).toEqual(['Anita Rao', 'Omar Khan'])
    expect(res.body.data.counts).toEqual({ all: 3, super: 1, scoped: 2 })
  })

  it.each([
    ['an unknown role', { role: 'owner' }],
    ['a role in the wrong case', { role: 'SUPER' }],
    ['a community id that isn\'t a uuid', { communityId: 'abc' }],
    ['a search over 100 characters', { search: 'x'.repeat(101) }],
  ])('rejects %s', async (_label, query) => {
    const res = await list(boss, query)
    expect(res.status).toBe(400)
  })

  describe('access', () => {
    it('is super-admin only: a community admin is refused', async () => {
      const res = await list(priya)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('SUPER_ADMIN_REQUIRED')
    })

    it('rejects unauthenticated requests and mobile members', async () => {
      expect((await request(app).get('/api/v1/admin/admins')).status).toBe(401)

      const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      const res = await request(app).get('/api/v1/admin/admins').set('Cookie', mobileCookie(member))
      expect(res.status).toBe(403)
    })
  })
})
