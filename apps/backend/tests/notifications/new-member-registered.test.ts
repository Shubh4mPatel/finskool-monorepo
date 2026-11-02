import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import redis from '../../src/lib/redis.js'
import { notificationsQueue, OTP_WHATSAPP_JOB } from '../../src/lib/queue.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// A member who finishes mobile registration (verify-otp) is announced to the admins who can open their profile,
// and the notification carries routing data that opens /admin/members/<id>.

const app = createApp()

let boss: TestAdmin
let freeAdmin: TestAdmin // can manage the free community, where new sign-ups land
let otherAdmin: TestAdmin // manages a different community only
let freeId: string

beforeEach(async () => {
  await resetDb()
  // A working in-memory Redis for the few commands registration uses (the shared mock resolves everything to null).
  const store = new Map<string, string>()
  vi.mocked(redis.set).mockImplementation((async (k: string, v: string) => { store.set(k, v); return 'OK' }) as never)
  vi.mocked(redis.get).mockImplementation((async (k: string) => store.get(k) ?? null) as never)
  vi.mocked(redis.del).mockImplementation((async (k: string) => (store.delete(k) ? 1 : 0)) as never)
  vi.mocked(redis.ttl).mockImplementation((async () => 600) as never)
  vi.mocked(notificationsQueue.add).mockClear()

  boss = await createAdmin({ isSuperAdmin: true })
  freeId = (await createCommunity(boss.id, { name: 'Feed', isFree: true })).id
  const paid = await createCommunity(boss.id, { name: 'Swing' })
  freeAdmin = await createAdmin({ isSuperAdmin: false, communityIds: [freeId] })
  otherAdmin = await createAdmin({ isSuperAdmin: false, communityIds: [paid.id] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function registerAndVerify() {
  const reg = await request(app).post('/api/v1/auth/mobile/register').send({
    fullName: 'Asha Rao',
    phone: '+919812345678',
    email: 'asha@example.com',
    password: 'SecurePass123',
    confirmPassword: 'SecurePass123',
  })
  expect(reg.status).toBe(201)
  const job = vi.mocked(notificationsQueue.add).mock.calls.find(c => c[0] === OTP_WHATSAPP_JOB)
  const otp = (job![1] as { otp: string }).otp
  const verify = await request(app).post('/api/v1/auth/mobile/verify-otp').send({ userId: reg.body.data.userId, otp })
  expect(verify.status).toBe(200)
  return prisma.user.findUniqueOrThrow({ where: { phone: '+919812345678' } })
}

describe('new member registers on mobile', () => {
  it('notifies the admins who can open the profile, and the notification opens it', async () => {
    const member = await registerAndVerify()

    const rows = await prisma.notification.findMany({ where: { type: 'new-member-registered' } })
    expect(rows.map(r => r.userId).sort()).toEqual([boss.id, freeAdmin.id].sort())
    expect(rows[0]).toMatchObject({
      title: 'Asha Rao has registered',
      sourceId: member.id,
      data: { type: 'member', id: member.id },
    })

    // What the admin web's bell lists: the routing data the click uses.
    const inbox = await request(app).get('/api/v1/notifications').set('Authorization', boss.auth)
    expect(inbox.status).toBe(200)
    const item = JSON.stringify(inbox.body.data).includes(member.id)
    expect(item).toBe(true)
  })

  it('does not notify an admin who cannot reach the new member', async () => {
    await registerAndVerify()
    const rows = await prisma.notification.findMany({ where: { type: 'new-member-registered', userId: otherAdmin.id } })
    expect(rows).toHaveLength(0)
  })

  it('notifies nobody when the code is wrong', async () => {
    const reg = await request(app).post('/api/v1/auth/mobile/register').send({
      fullName: 'Asha Rao', phone: '+919812345678', email: 'asha@example.com', password: 'SecurePass123', confirmPassword: 'SecurePass123',
    })
    const verify = await request(app).post('/api/v1/auth/mobile/verify-otp').send({ userId: reg.body.data.userId, otp: '000000' })
    expect(verify.status).toBe(400)
    expect(await prisma.notification.count({ where: { type: 'new-member-registered' } })).toBe(0)
  })
})
