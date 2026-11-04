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
      expect(res.body.data).toEqual({ items: [], total: 0, page: 1, pageSize: 1, totalPages: 1, counts: { all: 0, super: 0, scoped: 0 } })
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

  describe('paging', () => {
    // Alphabetical: Anita Rao, Omar Khan, Priya Shah, Zoya Boss.
    it('without page or pageSize returns every admin in one page (the reassign pickers rely on it)', async () => {
      const res = await list(boss)
      expect(names(res)).toHaveLength(4)
      expect(res.body.data).toMatchObject({ total: 4, page: 1, totalPages: 1 })
    })

    it('returns one page at a time, with the total and the number of pages', async () => {
      const first = await list(boss, { page: '1', pageSize: '3' })
      expect(names(first)).toEqual(['Anita Rao', 'Omar Khan', 'Priya Shah'])
      expect(first.body.data).toMatchObject({ total: 4, page: 1, pageSize: 3, totalPages: 2 })

      const second = await list(boss, { page: '2', pageSize: '3' })
      expect(names(second)).toEqual(['Zoya Boss'])
      expect(second.body.data).toMatchObject({ total: 4, page: 2, pageSize: 3, totalPages: 2 })
    })

    it('pageSize alone starts at page 1, page alone uses 10 a page', async () => {
      expect(names(await list(boss, { pageSize: '2' }))).toEqual(['Anita Rao', 'Omar Khan'])
      const pageOnly = await list(boss, { page: '1' })
      expect(pageOnly.body.data).toMatchObject({ page: 1, pageSize: 10, total: 4, totalPages: 1 })
    })

    it('a page past the end is empty but still reports the total', async () => {
      const res = await list(boss, { page: '9', pageSize: '3' })
      expect(res.status).toBe(200)
      expect(names(res)).toEqual([])
      expect(res.body.data).toMatchObject({ total: 4, totalPages: 2 })
    })

    it('the total follows the role tab, the search and the community, not the whole team', async () => {
      const scoped = await list(boss, { role: 'scoped', pageSize: '2' })
      expect(names(scoped)).toEqual(['Anita Rao', 'Omar Khan'])
      expect(scoped.body.data).toMatchObject({ total: 3, totalPages: 2 })
      // The tab counts are untouched by paging.
      expect(scoped.body.data.counts).toEqual({ all: 4, super: 1, scoped: 3 })

      const searched = await list(boss, { search: 'a', pageSize: '2' })
      expect(searched.body.data.total).toBe(searched.body.data.counts.all)

      const inOptions = await list(boss, { communityId: options.id, role: 'super', pageSize: '1' })
      expect(names(inOptions)).toEqual(['Zoya Boss'])
      expect(inOptions.body.data).toMatchObject({ total: 1, totalPages: 1 })
    })

    it('admins with the same name keep a stable order, so no one repeats or goes missing across pages', async () => {
      await createAdmin({ isSuperAdmin: false, name: 'Priya Shah', email: 'priya.two@finskool.test' })
      await createAdmin({ isSuperAdmin: false, name: 'Priya Shah', email: 'priya.three@finskool.test' })
      const seen: string[] = []
      for (let page = 1; page <= 7; page++) {
        const res = await list(boss, { page: String(page), pageSize: '1' })
        seen.push(...res.body.data.items.map((a: { id: string }) => a.id))
      }
      expect(seen).toHaveLength(6)
      expect(new Set(seen).size).toBe(6)
    })

    it.each([
      ['page 0', { page: '0' }],
      ['a page that is not a number', { page: 'abc' }],
      ['a pageSize of 0', { pageSize: '0' }],
      ['a pageSize over 100', { pageSize: '101' }],
    ])('rejects %s', async (_label, query) => {
      expect((await list(boss, query)).status).toBe(400)
    })
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
