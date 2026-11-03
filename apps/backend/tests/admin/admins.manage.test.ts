import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, nextMobile, type TestAdmin } from '../helpers/fixtures.js'

// Roles & Admins: creating, re-scoping, deleting and granting access to admin accounts. Everything here is
// super-admin only, so most of the file is about who is refused, what bad input does, and what the new
// (or removed) admin can do afterwards.

const app = createApp()

let boss: TestAdmin
let other: TestAdmin // a second super admin
let swing: { id: string }
let options: { id: string }
let scoped: TestAdmin // community admin of Swing

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Nikhil Rao',
  email: 'nikhil@finskool.test',
  phone: '9811100001',
  password: 'Str0ngPass!',
  communityIds: [swing.id],
  ...over,
})
const create = (as: TestAdmin, over: Record<string, unknown> = {}) => request(app).post('/api/v1/admin/admins').set('Authorization', as.auth).send(body(over))
const patchAccess = (as: TestAdmin, id: string, communityIds: unknown) => request(app).patch(`/api/v1/admin/admins/${id}`).set('Authorization', as.auth).send({ communityIds })
const remove = (as: TestAdmin, id: string) => request(app).delete(`/api/v1/admin/admins/${id}`).set('Authorization', as.auth)
const grant = (as: TestAdmin, id: string, communityId: unknown) => request(app).post(`/api/v1/admin/admins/${id}/communities`).set('Authorization', as.auth).send({ communityId })
const revoke = (as: TestAdmin, id: string, communityId: string) => request(app).delete(`/api/v1/admin/admins/${id}/communities/${communityId}`).set('Authorization', as.auth)
const access = async (adminId: string) => (await prisma.communityAdmin.findMany({ where: { adminId } })).map(r => r.communityId).sort()

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true, name: 'Zoya Boss', email: 'zoya@finskool.test' })
  other = await createAdmin({ isSuperAdmin: true, name: 'Second Boss', email: 'second@finskool.test' })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id], name: 'Priya Shah', email: 'priya@finskool.test' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('who may manage admins', () => {
  it('refuses a community admin on every admin-management route', async () => {
    const target = await createAdmin({ isSuperAdmin: false, communityIds: [options.id] })
    const results = await Promise.all([
      create(scoped),
      patchAccess(scoped, target.id, [swing.id]),
      remove(scoped, target.id),
      grant(scoped, target.id, swing.id),
      revoke(scoped, target.id, options.id),
    ])
    expect(results.map(r => r.status)).toEqual([403, 403, 403, 403, 403])
    expect(await access(target.id)).toEqual([options.id]) // nothing changed
    expect(await prisma.user.count({ where: { role: 'admin', deletedAt: null } })).toBe(4)
  })

  it('refuses a mobile member and an unauthenticated caller', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
    const asMember = await request(app).post('/api/v1/admin/admins').set('Cookie', `mobile_session_id=${member.sessionId}`).send(body())
    expect(asMember.status).toBe(403)
    expect((await request(app).post('/api/v1/admin/admins').send(body())).status).toBe(401)
    expect((await request(app).delete(`/api/v1/admin/admins/${scoped.id}`)).status).toBe(401)
  })

  it('treats a token whose claims say "super admin" but whose database row says otherwise as what the database says', async () => {
    // A forged claim cannot be made without the secret, but a stale one can exist: an admin demoted after
    // their token was issued. The service re-checks the database for every admin-management action.
    const forged = jwt.sign(
      { sub: scoped.id, role: 'admin', type: 'access', communityIds: [], selectedCommunityId: null, accessibleCommunityIds: null, isSuperAdmin: true },
      env.jwt.secret,
      { expiresIn: '5m' },
    )
    const res = await request(app).post('/api/v1/admin/admins').set('Authorization', `Bearer ${forged}`).send(body())
    expect(res.status).toBe(403)
  })
})

describe('POST /admin/admins — create', () => {
  it('creates a community admin, normalises the phone, hashes the password and grants the communities', async () => {
    const res = await create(boss, { communityIds: [swing.id, options.id] })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'Nikhil Rao', email: 'nikhil@finskool.test', isSuperAdmin: false })
    expect(res.body.data.communityAccess.map((c: { id: string }) => c.id).sort()).toEqual([swing.id, options.id].sort())

    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(row.role).toBe('admin')
    expect(row.isSuperAdmin).toBe(false) // an API call can never mint a super admin
    expect(row.phone).toBe('+919811100001')
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(row.passwordHash).not.toContain('Str0ngPass!')
    expect(await access(row.id)).toEqual([swing.id, options.id].sort())
  })

  it('lets the new admin log in to the dashboard with the password that was set, and no other', async () => {
    await create(boss)
    const ok = await request(app).post('/api/v1/auth/login').send({ email: 'nikhil@finskool.test', password: 'Str0ngPass!' })
    expect(ok.status).toBe(200)
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'nikhil@finskool.test', password: 'wrong-password' })
    expect(bad.status).toBe(401)
  })

  it('gives the new admin exactly the access they were created with', async () => {
    const res = await create(boss, { communityIds: [swing.id] })
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'nikhil@finskool.test', password: 'Str0ngPass!' })
    const cookies = (login.headers['set-cookie'] as unknown as string[]).map(c => c.split(';')[0]).join('; ')
    const mine = await request(app).get('/api/v1/admin/communities').set('Cookie', cookies)
    expect(mine.status).toBe(200)
    expect(mine.body.data.map((c: { id: string }) => c.id)).toEqual([swing.id])
    expect(res.status).toBe(201)
  })

  it('lower-cases the email', async () => {
    const res = await create(boss, { email: 'Mixed.Case@Finskool.TEST' })
    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe('mixed.case@finskool.test')
  })

  describe('validation', () => {
    it.each([
      ['a one-character name', { name: 'A' }],
      ['an empty name', { name: '' }],
      ['a name of only spaces', { name: '   ' }],
      ['an invalid email', { email: 'not-an-email' }],
      ['a missing email', { email: undefined }],
      ['a password under 8 characters', { password: 'short1' }],
      ['a missing password', { password: undefined }],
      ['a missing phone', { phone: '' }],
      ['an empty community list', { communityIds: [] }],
      ['a community id that is not a uuid', { communityIds: ['nope'] }],
      ['communityIds as a string', { communityIds: swing?.id }],
      ['a name over 100 characters', { name: 'N'.repeat(101) }],
      ['an email over 255 characters', { email: `${'a'.repeat(250)}@x.test` }],
      ['a password over 128 characters', { password: 'p'.repeat(1000) }],
    ])('rejects %s with a 4xx, never a 500', async (_label, over) => {
      const res = await create(boss, over)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      expect(await prisma.user.count({ where: { email: 'nikhil@finskool.test' } })).toBe(0)
    })

    it('rejects an invalid phone number', async () => {
      const res = await create(boss, { phone: '12345' })
      expect(res.status).toBe(400)
    })

    it('rejects an unknown community, and a deleted one', async () => {
      expect((await create(boss, { communityIds: ['5b3f4c1e-0000-4000-8000-000000000000'] })).status).toBe(400)
      await prisma.community.update({ where: { id: options.id }, data: { deletedAt: new Date() } })
      expect((await create(boss, { communityIds: [options.id] })).status).toBe(400)
    })

    it('rejects the same community listed twice with a clear 4xx (not a unique-key 500)', async () => {
      const res = await create(boss, { communityIds: [swing.id, swing.id] })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('does not leave a half-created admin behind when the communities are invalid', async () => {
      await create(boss, { communityIds: ['5b3f4c1e-0000-4000-8000-000000000000'] })
      expect(await prisma.user.count({ where: { phone: '+919811100001' } })).toBe(0)
    })
  })

  describe('duplicates', () => {
    it('refuses a phone already used by an admin, whatever format it is typed in', async () => {
      await create(boss)
      for (const phone of ['9811100001', '+919811100001', '+91 98111 00001', '09811100001']) {
        const res = await create(boss, { phone, email: `x${phone.replace(/\D/g, '')}@finskool.test` })
        expect(res.status, phone).toBe(409)
        expect(res.body.code).toBe('PHONE_EXISTS')
      }
    })

    it('refuses a phone that already belongs to a mobile member', async () => {
      const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
      const res = await create(boss, { phone: member.phone })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('PHONE_EXISTS')
    })

    it('refuses an email already used by an admin or a member, in any letter case', async () => {
      const member = await createMobileMember({ email: 'member.one@finskool.test', subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
      expect((await create(boss, { email: 'ZOYA@finskool.test' })).body.code).toBe('EMAIL_EXISTS')
      expect((await create(boss, { email: member.email!.toUpperCase() })).body.code).toBe('EMAIL_EXISTS')
    })

    it('refuses the email and phone of a deleted admin too (they stay reserved)', async () => {
      const first = await create(boss)
      await remove(boss, first.body.data.id)
      const again = await create(boss, { phone: nextMobile() })
      expect(again.status).toBe(409)
    })

    it('two simultaneous requests for the same email give one 201 and one clean 409, never a 500', async () => {
      const results = await Promise.all([create(boss, { phone: nextMobile() }), create(boss, { phone: nextMobile() }), create(boss, { phone: nextMobile() })])
      const statuses = results.map(r => r.status).sort()
      expect(statuses.filter(s => s === 201)).toHaveLength(1)
      expect(statuses.some(s => s >= 500)).toBe(false)
      expect(await prisma.user.count({ where: { email: 'nikhil@finskool.test' } })).toBe(1)
    })

    it('two simultaneous requests for the same phone give one 201 and clean 409s', async () => {
      const results = await Promise.all([1, 2, 3].map(i => create(boss, { email: `same-phone-${i}@finskool.test` })))
      expect(results.filter(r => r.status === 201)).toHaveLength(1)
      expect(results.some(r => r.status >= 500)).toBe(false)
    })
  })
})

describe('PATCH /admin/admins/:id — replace a community admin\'s communities', () => {
  it('replaces the set (grants the new ones, removes the old ones)', async () => {
    const res = await patchAccess(boss, scoped.id, [options.id])
    expect(res.status).toBe(200)
    expect(res.body.data.communityAccess.map((c: { id: string }) => c.id)).toEqual([options.id])
    expect(await access(scoped.id)).toEqual([options.id])
  })

  it('is refused for your own account, even for a super admin', async () => {
    const res = await patchAccess(boss, boss.id, [swing.id])
    expect(res.status).toBe(403)
    expect(await access(boss.id)).toEqual([])
  })

  it('returns 404 for a mobile member, a deleted admin and an unknown id', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
    const gone = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    expect((await patchAccess(boss, member.id, [swing.id])).status).toBe(404)
    expect((await patchAccess(boss, gone.id, [swing.id])).status).toBe(404)
    expect((await patchAccess(boss, '5b3f4c1e-0000-4000-8000-000000000000', [swing.id])).status).toBe(404)
    expect(await prisma.communityAdmin.count({ where: { adminId: member.id } })).toBe(0)
  })

  it('rejects an empty list (it would silently turn a community admin into one who can see nothing)', async () => {
    expect((await patchAccess(boss, scoped.id, [])).status).toBeLessThan(500)
    expect((await patchAccess(boss, scoped.id, [])).status).toBeGreaterThanOrEqual(400)
    expect(await access(scoped.id)).toEqual([swing.id])
  })

  it('rejects an unknown or deleted community and leaves the old access untouched', async () => {
    expect((await patchAccess(boss, scoped.id, ['5b3f4c1e-0000-4000-8000-000000000000'])).status).toBe(400)
    await prisma.community.update({ where: { id: options.id }, data: { deletedAt: new Date() } })
    expect((await patchAccess(boss, scoped.id, [options.id])).status).toBe(400)
    expect(await access(scoped.id)).toEqual([swing.id])
  })

  it('rejects a duplicated community id with a 4xx, not a 500, and keeps the old access', async () => {
    const res = await patchAccess(boss, scoped.id, [options.id, options.id])
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await access(scoped.id)).toEqual([swing.id])
  })

  it('is all-or-nothing: a failure in the middle does not strip the old access', async () => {
    const res = await patchAccess(boss, scoped.id, [options.id, 'not-a-uuid'])
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await access(scoped.id)).toEqual([swing.id])
  })

  it('takes effect for the admin at their next login: the roster they see follows the new communities', async () => {
    const member = await createMobileMember({ name: 'In Options', subscriptions: [{ communityId: options.id, validUntil: '2030-01-01' }] })
    await patchAccess(boss, scoped.id, [options.id])
    // A fresh token (what login/refresh issue) carries the new scope.
    const fresh = jwt.sign(
      { sub: scoped.id, role: 'admin', type: 'access', communityIds: [], selectedCommunityId: null, accessibleCommunityIds: await access(scoped.id), isSuperAdmin: false },
      env.jwt.secret,
      { expiresIn: '5m' },
    )
    const roster = await request(app).get('/api/v1/admin/members').set('Authorization', `Bearer ${fresh}`)
    expect(roster.status).toBe(200)
    expect(roster.body.data.members.map((m: { id: string }) => m.id)).toEqual([member.id])
  })
})

describe('DELETE /admin/admins/:id', () => {
  it('soft-deletes the admin: gone from the list, cannot log in, row kept', async () => {
    const target = await create(boss)
    const id = target.body.data.id
    expect((await remove(boss, id)).status).toBe(200)
    const row = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).not.toBeNull()
    const list = await request(app).get('/api/v1/admin/admins').set('Authorization', boss.auth)
    expect(list.body.data.items.map((a: { id: string }) => a.id)).not.toContain(id)
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'nikhil@finskool.test', password: 'Str0ngPass!' })
    expect(login.status).toBe(401)
  })

  it('cannot delete yourself, even when you are the only super admin', async () => {
    expect((await remove(boss, boss.id)).status).toBe(403)
    expect(await prisma.user.count({ where: { id: boss.id, deletedAt: null } })).toBe(1)
  })

  it('can delete another super admin', async () => {
    expect((await remove(boss, other.id)).status).toBe(200)
  })

  it('two super admins deleting each other at the same moment never leaves zero super admins', async () => {
    const results = await Promise.all([remove(boss, other.id), remove(other, boss.id)])
    expect(results.some(r => r.status >= 500)).toBe(false)
    expect(results.filter(r => r.status === 200)).toHaveLength(1)
    expect(await prisma.user.count({ where: { role: 'admin', isSuperAdmin: true, deletedAt: null } })).toBe(1)
  })

  it('returns 404 for a mobile member, an already deleted admin and an unknown id — and never touches the member', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
    expect((await remove(boss, member.id)).status).toBe(404)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).deletedAt).toBeNull()
    await remove(boss, scoped.id)
    expect((await remove(boss, scoped.id)).status).toBe(404)
    expect((await remove(boss, '5b3f4c1e-0000-4000-8000-000000000000')).status).toBe(404)
  })

  it('also stops the deleted admin\'s refresh tokens from minting new access tokens', async () => {
    const target = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id], password: 'Str0ngPass!' })
    const refresh = jwt.sign({ sub: target.id, role: 'admin', type: 'refresh', communityIds: [], selectedCommunityId: null, accessibleCommunityIds: [swing.id], isSuperAdmin: false }, env.jwt.secret, { expiresIn: '5m' })
    await remove(boss, target.id)
    const res = await request(app).get('/api/v1/auth/refresh').set('Cookie', `refresh_token=${refresh}`)
    expect(res.status).toBe(401)
  })
})

describe('POST /admin/admins/:id/communities and DELETE …/:communityId', () => {
  it('grants a community, idempotently', async () => {
    expect((await grant(boss, scoped.id, options.id)).status).toBe(201)
    expect((await grant(boss, scoped.id, options.id)).status).toBe(201)
    expect(await access(scoped.id)).toEqual([swing.id, options.id].sort())
    expect(await prisma.communityAdmin.count({ where: { adminId: scoped.id, communityId: options.id } })).toBe(1)
  })

  it('refuses an unknown or deleted community, and a non-uuid one', async () => {
    expect((await grant(boss, scoped.id, '5b3f4c1e-0000-4000-8000-000000000000')).status).toBe(404)
    await prisma.community.update({ where: { id: options.id }, data: { deletedAt: new Date() } })
    expect((await grant(boss, scoped.id, options.id)).status).toBe(404)
    expect((await grant(boss, scoped.id, 'junk')).status).toBe(400)
    expect((await grant(boss, scoped.id, undefined)).status).toBe(400)
  })

  it('refuses a mobile member, a deleted admin, an unknown id and a non-uuid id as the target', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-01-01' }] })
    const gone = await createAdmin({ isSuperAdmin: false })
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
    const statuses = await Promise.all([
      grant(boss, member.id, options.id),
      grant(boss, gone.id, options.id),
      grant(boss, '5b3f4c1e-0000-4000-8000-000000000000', options.id),
      grant(boss, 'junk', options.id),
    ])
    for (const r of statuses) expect([400, 404]).toContain(r.status)
    expect(await prisma.communityAdmin.count({ where: { adminId: { in: [member.id, gone.id] } } })).toBe(0)
  })

  it('revokes a community, and answers cleanly when there was nothing to revoke', async () => {
    expect((await revoke(boss, scoped.id, swing.id)).status).toBe(200)
    expect(await access(scoped.id)).toEqual([])
    expect((await revoke(boss, scoped.id, swing.id)).status).toBeLessThan(500)
  })

  it('returns a 4xx, not a 500, for non-uuid ids on revoke', async () => {
    const res = await request(app).delete('/api/v1/admin/admins/junk/communities/also-junk').set('Authorization', boss.auth)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})
