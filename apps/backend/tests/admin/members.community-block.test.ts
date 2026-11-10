import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { randomUUID } from 'node:crypto'
import { notificationsQueue, COMMUNITY_BLOCKED_EMAIL_JOB, COMMUNITY_UNBLOCKED_EMAIL_JOB, PUSH_NOTIFICATION_JOB } from '../../src/lib/queue.js'
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js'
import { notifyMemberThread } from '../../src/lib/member-notify.js'
import { retryPendingPushes } from '../../src/lib/push.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  mobileCookie,
  daysFromNow,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// A community block switches off a member's access to ONE community. Unlike an account suspension it leaves the
// account signed in and every other community working, and the reason is stored per (member, community).

vi.mock('../../src/lib/razorpay.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/razorpay.js')>()
  return { ...actual, getRazorpayClient: () => ({ orders: { create: async () => ({ id: 'order_blocked_test' }) } }) }
})

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)

let superAdmin: TestAdmin
let swing: { id: string; name: string }
let options: { id: string; name: string }
let member: TestMobileMember

const blockUrl = (userId: string, communityId: string) => `/api/v1/admin/members/${userId}/communities/${communityId}/block`
const block = (communityId: string, reason: unknown = 'Sharing paid calls outside the group', admin = superAdmin, userId = member.id) =>
  request(app).post(blockUrl(userId, communityId)).set('Authorization', admin.auth).send({ reason })
const unblock = (communityId: string, admin = superAdmin, userId = member.id) =>
  request(app).delete(blockUrl(userId, communityId)).set('Authorization', admin.auth)

const feed = (communityId: string) =>
  request(app).get(`/api/v1/mobile/posts?communityId=${communityId}`).set('Cookie', mobileCookie(member))
const mobileProbe = () => request(app).get('/api/v1/mobile/communities').set('Cookie', mobileCookie(member))
const jobsNamed = (name: string) => queueAdd.mock.calls.filter(([n]) => n === name).map(([, payload]) => payload)
const subOf = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } })

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  superAdmin = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(superAdmin.id, { name: 'Swing Traders' })
  options = await createCommunity(superAdmin.id, { name: 'Options Club' })
  member = await createMobileMember({
    name: 'Anita Rao',
    email: 'anita@example.com',
    subscriptions: [
      { communityId: swing.id, validUntil: daysFromNow(30) },
      { communityId: options.id, validUntil: daysFromNow(30) },
    ],
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /admin/members/:id/communities/:communityId/block', () => {
  it('blocks the member in that community only, and stores the reason', async () => {
    expect((await feed(swing.id)).status).toBe(200)

    const res = await block(swing.id, '  Sharing paid calls outside the group  ')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      userId: member.id,
      communityId: swing.id,
      blocked: true,
      reason: 'Sharing paid calls outside the group',
    })

    const row = await prisma.communityBlock.findUniqueOrThrow({
      where: { uq_community_block: { userId: member.id, communityId: swing.id } },
    })
    expect(row).toMatchObject({ reason: 'Sharing paid calls outside the group', blockedBy: superAdmin.id })
    expect(row.suspendedSubscriptionIds).toEqual([member.subscriptionIds[0]])

    // Blocked community: no access. Other community and the account itself: untouched.
    expect((await subOf(member.subscriptionIds[0]!)).isActive).toBe(false)
    expect((await subOf(member.subscriptionIds[1]!)).isActive).toBe(true)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('active')

    const blocked = await feed(swing.id)
    expect(blocked.status).toBe(403)
    expect(blocked.body.code).toBe('COMMUNITY_BLOCKED')
    expect((await feed(options.id)).status).toBe(200)
    expect((await mobileProbe()).status).toBe(200)

    expect(jobsNamed(COMMUNITY_BLOCKED_EMAIL_JOB)).toEqual([
      { toEmail: 'anita@example.com', name: 'Anita Rao', communityName: 'Swing Traders', reason: 'Sharing paid calls outside the group' },
    ])
  })

  it('keeps the community subscriber count in step', async () => {
    await prisma.community.update({ where: { id: swing.id }, data: { activeSubCount: 1 } })
    await block(swing.id)
    expect((await prisma.community.findUniqueOrThrow({ where: { id: swing.id } })).activeSubCount).toBe(0)
  })

  it('keeps a separate reason for each community the member is blocked from', async () => {
    await block(swing.id, 'Reason A')
    await block(options.id, 'Reason B')

    const rows = await prisma.communityBlock.findMany({ where: { userId: member.id }, orderBy: { reason: 'asc' } })
    expect(rows.map(r => [r.communityId, r.reason])).toEqual([[swing.id, 'Reason A'], [options.id, 'Reason B']])
  })

  it('lets the member still sign in when other access remains', async () => {
    await block(swing.id)
    const login = await request(app)
      .post('/api/v1/auth/mobile/login')
      .set('User-Agent', 'Finskool/1.0 (Android 14; Pixel 8)')
      .send({ email: 'anita@example.com', password: member.password, deviceType: 'android', deviceId: 'device-under-test' })
    expect(login.status).toBe(200)
  })

  it('tells a member with no access left which community blocked them and why', async () => {
    await block(swing.id, 'Chargeback')
    await block(options.id, 'Chargeback')
    await prisma.subscription.deleteMany({ where: { userId: member.id, community: { isFree: true } } })

    const login = await request(app)
      .post('/api/v1/auth/mobile/login')
      .set('User-Agent', 'Finskool/1.0 (Android 14; Pixel 8)')
      .send({ email: 'anita@example.com', password: member.password, deviceType: 'android', deviceId: 'device-under-test' })
    expect(login.status).toBe(403)
    expect(login.body.code).toBe('COMMUNITY_BLOCKED')
    expect(login.body.message).toContain('Chargeback')
  })

  it('shows the block on the member in the admin API', async () => {
    await block(swing.id, 'Chargeback')

    const res = await request(app).get(`/api/v1/admin/members/${member.id}`).set('Authorization', superAdmin.auth)
    const subs = res.body.data.allSubscriptions as { communityId: string; isActive: boolean; block: { reason: string } | null }[]
    expect(subs.find(s => s.communityId === swing.id)).toMatchObject({ isActive: false, block: { reason: 'Chargeback' } })
    expect(subs.find(s => s.communityId === options.id)).toMatchObject({ isActive: true, block: null })
  })

  it('requires a reason', async () => {
    const missing = await request(app).post(blockUrl(member.id, swing.id)).set('Authorization', superAdmin.auth).send({})
    expect(missing.status).toBe(400)
    for (const reason of ['', '   ']) expect((await block(swing.id, reason)).status).toBe(400)
    const tooLong = await block(swing.id, 'x'.repeat(1001))
    expect(tooLong.status).toBe(400)
    expect(await prisma.communityBlock.count()).toBe(0)
  })

  it('refuses a second block of the same member and community', async () => {
    expect((await block(swing.id)).status).toBe(200)
    const again = await block(swing.id, 'Another reason')
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('ALREADY_BLOCKED')
    expect((await prisma.communityBlock.findFirstOrThrow()).reason).toBe('Sharing paid calls outside the group')
  })

  it('refuses a community the member is not in, an unknown member and an admin account', async () => {
    const elsewhere = await createCommunity(superAdmin.id, { name: 'Elsewhere' })
    expect((await block(elsewhere.id)).status).toBe(404)

    const otherAdmin = await createAdmin()
    expect((await block(swing.id, 'x', superAdmin, otherAdmin.id)).status).toBe(404)
    expect((await block(swing.id, 'x', superAdmin, '00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })

  it('needs access to that community', async () => {
    const scopedToOptions = await createAdmin({ isSuperAdmin: false, communityIds: [options.id] })

    expect((await block(swing.id, 'x', scopedToOptions)).status).toBe(403)
    expect((await unblock(swing.id, scopedToOptions)).status).toBe(403)
    expect((await block(options.id, 'x', scopedToOptions)).status).toBe(200)
    expect((await subOf(member.subscriptionIds[0]!)).isActive).toBe(true)
  })

  it('rejects members and anonymous callers', async () => {
    expect((await request(app).post(blockUrl(member.id, swing.id)).send({ reason: 'x' })).status).toBe(401)
    const asMember = await request(app).post(blockUrl(member.id, swing.id)).set('Cookie', mobileCookie(member)).send({ reason: 'x' })
    expect([401, 403]).toContain(asMember.status)
  })
})

describe('while blocked', () => {
  beforeEach(async () => {
    await block(swing.id, 'Chargeback')
  })

  it('cannot buy a plan for the community', async () => {
    const plan = await prisma.plan.create({ data: { communityId: swing.id, name: '3 Month', durationMonths: 3, price: 999 } })
    const res = await request(app)
      .post('/api/v1/payments/checkout-sessions')
      .set('Cookie', mobileCookie(member))
      .send({ communityId: swing.id, planId: plan.id })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('COMMUNITY_BLOCKED')
    expect(res.body.message).toContain('Chargeback')
    expect(await prisma.planOrder.count()).toBe(0)
  })

  it('cannot be extended by an admin', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/subscriptions/${member.subscriptionIds[0]}/extend`)
      .set('Authorization', superAdmin.auth)
      .send({ validUntil: daysFromNow(90), payment: 1000 })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('COMMUNITY_BLOCKED')
    expect(res.body.message).toBe('This member is suspended from this community. Revoke the suspension first.')
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId: swing.id } })).toBe(1)
  })

  it('can still buy a plan for a community they are not blocked from', async () => {
    const plan = await prisma.plan.create({ data: { communityId: options.id, name: '3 Month', durationMonths: 3, price: 999 } })
    const res = await request(app)
      .post('/api/v1/payments/checkout-sessions')
      .set('Cookie', mobileCookie(member))
      .send({ communityId: options.id, planId: plan.id })
    expect(res.status).not.toBe(403)
  })
})

describe('DELETE /admin/members/:id/communities/:communityId/block', () => {
  it('unblocks the member and gives the access back', async () => {
    await block(swing.id)
    expect((await feed(swing.id)).status).toBe(403)
    queueAdd.mockClear()

    const res = await unblock(swing.id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ userId: member.id, communityId: swing.id, blocked: false, reason: null })

    expect(await prisma.communityBlock.count()).toBe(0)
    expect((await subOf(member.subscriptionIds[0]!)).isActive).toBe(true)
    expect((await feed(swing.id)).status).toBe(200)
    expect(jobsNamed(COMMUNITY_UNBLOCKED_EMAIL_JOB)).toEqual([
      { toEmail: 'anita@example.com', name: 'Anita Rao', communityName: 'Swing Traders' },
    ])
  })

  it('restores only what the block switched off, not rows that were already inactive or have since expired', async () => {
    const old = await prisma.subscription.create({
      data: { userId: member.id, communityId: swing.id, payment: 100, validUntil: new Date(daysFromNow(-60)), isActive: false, createdAt: new Date(Date.now() - 90 * 864e5) },
    })
    await block(swing.id)
    // The remaining row lapses while blocked.
    await prisma.subscription.update({ where: { id: member.subscriptionIds[0]! }, data: { validUntil: new Date(daysFromNow(-5)) } })

    await unblock(swing.id)

    expect((await subOf(old.id)).isActive).toBe(false)
    expect((await subOf(member.subscriptionIds[0]!)).isActive).toBe(false)
    expect(await prisma.communityBlock.count()).toBe(0)
  })

  it('is a conflict when the member is not blocked', async () => {
    const res = await unblock(swing.id)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NOT_BLOCKED')
  })

  it('does not touch an account-wide suspension', async () => {
    await block(swing.id)
    await prisma.user.update({ where: { id: member.id }, data: { status: 'suspended', suspensionReason: 'Chargeback' } })
    await unblock(swing.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('suspended')
  })
})

describe('a blocked member gets no notifications for that community', () => {
  const inbox = () => request(app).get('/api/v1/notifications').set('Cookie', mobileCookie(member))
  const unread = () => request(app).get('/api/v1/notifications/unread-count').set('Cookie', mobileCookie(member))
  const titles = (res: request.Response) => res.body.data.notifications.map((n: { title: string }) => n.title).sort()

  const seed = (title: string, communityId: string | null, userId = member.id) =>
    prisma.notification.create({
      data: { userId, communityId, type: 'post', sourceId: randomUUID(), title, message: 'details', pushPending: false },
    })

  it('hides existing inbox rows of the blocked community, and only those', async () => {
    await seed('Swing post', swing.id)
    await seed('Options post', options.id)
    await seed('Service update', null)

    expect(titles(await inbox())).toEqual(['Options post', 'Service update', 'Swing post'])

    await block(swing.id)

    const after = await inbox()
    expect(titles(after)).toEqual(['Options post', 'Service update'])
    expect(after.body.data.total).toBe(2)

    // The blocked community's own filter is empty too.
    const filtered = await request(app).get(`/api/v1/notifications?communityId=${swing.id}`).set('Cookie', mobileCookie(member))
    expect(titles(filtered)).toEqual([])

    await unblock(swing.id)
    expect(titles(await inbox())).toEqual(['Options post', 'Service update', 'Swing post'])
  })

  it('does not count them as unread', async () => {
    await seed('Swing post', swing.id)
    await seed('Options post', options.id)
    const count = async () => (await unread()).body.data.count as number
    expect(await count()).toBe(2)
    await block(swing.id)
    expect(await count()).toBe(1)
  })

  it('is left out of a new post announcement, while other members still get it', async () => {
    const other = await createMobileMember({
      email: null,
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }],
    })
    await block(swing.id)

    const result = await new NotificationsService(prisma).fanOutCommunityPost({
      communityId: swing.id,
      postId: randomUUID(),
      message: 'New post',
      triggeredByUserId: superAdmin.id,
      postTitle: 'Nifty setup',
      postExcerpt: 'Levels for tomorrow',
    })

    expect(result.created).toBe(1)
    expect(await prisma.notification.count({ where: { userId: member.id } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: other.id } })).toBe(1)
    expect(jobsNamed(PUSH_NOTIFICATION_JOB).flatMap(p => (p as { userIds: string[] }).userIds)).toEqual([other.id])
  })

  it('is not told about ticket activity in that community, but still about other communities', async () => {
    await block(swing.id)
    queueAdd.mockClear()
    const base = { db: prisma, userId: member.id, kind: 'ticket' as const, title: 'Reply', message: 'We replied', event: 'reply' }

    await notifyMemberThread({ ...base, threadId: randomUUID(), eventId: randomUUID(), communityId: swing.id })
    expect(await prisma.notification.count({ where: { userId: member.id } })).toBe(0)
    expect(jobsNamed(PUSH_NOTIFICATION_JOB)).toHaveLength(0)

    await notifyMemberThread({ ...base, threadId: randomUUID(), eventId: randomUUID(), communityId: options.id })
    expect(await prisma.notification.count({ where: { userId: member.id } })).toBe(1)
  })

  it('does not push, late, a notification saved before the block', async () => {
    const pending = await prisma.notification.create({
      data: { userId: member.id, communityId: swing.id, type: 'post', sourceId: randomUUID(), title: 'Old', message: 'x', pushPending: true, createdAt: new Date(Date.now() - 5 * 60_000) },
    })
    await block(swing.id)
    queueAdd.mockClear()

    await retryPendingPushes(prisma)

    expect(jobsNamed(PUSH_NOTIFICATION_JOB)).toHaveLength(0)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: pending.id } })).pushPending).toBe(false)
  })
})

describe('what a blocked member is told when they try to use the community', () => {
  let post: { id: string }

  /** Says where, why and who to ask; the same wording everywhere. */
  const expectSuspendedMessage = (res: request.Response, reason = 'Chargeback') => {
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('COMMUNITY_BLOCKED')
    expect(res.body.message).toBe(`You have been suspended from Swing Traders. Reason: ${reason}. Please contact the admin.`)
  }

  beforeEach(async () => {
    post = await prisma.post.create({
      data: { communityId: swing.id, authorId: superAdmin.id, title: 'Nifty setup', contentMd: 'body', status: 'published', publishedAt: new Date() },
    })
    await prisma.reactionType.create({ data: { id: 1, name: 'like', emoji: '👍', sortOrder: 1 } })
    await block(swing.id, 'Chargeback')
  })

  it('on the feed', async () => {
    expectSuspendedMessage(await feed(swing.id))
    const mobileFeed = await request(app).get(`/api/v1/mobile/posts?communityId=${swing.id}`).set('Cookie', mobileCookie(member))
    expectSuspendedMessage(mobileFeed)
  })

  it('on comments', async () => {
    const res = await request(app).post(`/api/v1/posts/${post.id}/comments`).set('Cookie', mobileCookie(member)).send({ content: 'hello' })
    expectSuspendedMessage(res)
    expect(await prisma.comment.count()).toBe(0)
  })

  it('on reactions', async () => {
    const res = await request(app).put(`/api/v1/mobile/posts/${post.id}/reactions`).set('Cookie', mobileCookie(member)).send({ reactionTypeId: 1 })
    expectSuspendedMessage(res)
    expect(await prisma.reaction.count()).toBe(0)
  })

  it('on the welcome kit', async () => {
    const res = await request(app).get(`/api/v1/mobile/communities/${swing.id}/welcome-kit`).set('Cookie', mobileCookie(member))
    expectSuspendedMessage(res)
  })

  it('on buying a plan', async () => {
    const plan = await prisma.plan.create({ data: { communityId: swing.id, name: '3 Month', durationMonths: 3, price: 999 } })
    const res = await request(app).post('/api/v1/payments/checkout-sessions').set('Cookie', mobileCookie(member)).send({ communityId: swing.id, planId: plan.id })
    expectSuspendedMessage(res)
  })

  it('gives the other community, and a stranger to this one, their normal answers', async () => {
    expect((await feed(options.id)).status).toBe(200)

    const stranger = await createMobileMember({ subscriptions: [{ communityId: options.id, validUntil: daysFromNow(30) }] })
    const res = await request(app).get(`/api/v1/mobile/posts?communityId=${swing.id}`).set('Cookie', mobileCookie(stranger))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  it('stops being said once they are unblocked', async () => {
    await unblock(swing.id)
    expect((await feed(swing.id)).status).toBe(200)
  })
})

describe('extending and re-adding, suspended or not', () => {
  const extend = (subscriptionId: string) =>
    request(app)
      .post(`/api/v1/admin/subscriptions/${subscriptionId}/extend`)
      .set('Authorization', superAdmin.auth)
      .send({ validUntil: daysFromNow(90), payment: 1000 })

  it('lets an admin extend a normal member whose subscription has expired', async () => {
    const expired = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-20), isActive: false }],
    })

    const res = await extend(expired.subscriptionIds[0]!)

    expect(res.status).toBe(201)
    const active = await prisma.subscription.findMany({ where: { userId: expired.id, communityId: swing.id, isActive: true } })
    expect(active).toHaveLength(1)
    expect(active[0]!.validUntil!.toISOString().slice(0, 10)).toBe(daysFromNow(90))
  })

  it('refuses the same for a member suspended in that community, until the suspension is revoked', async () => {
    await block(swing.id, 'Chargeback')
    const refused = await extend(member.subscriptionIds[0]!)
    expect(refused.status).toBe(403)
    expect(refused.body.message).toContain('Revoke the suspension first')

    await unblock(swing.id)
    expect((await extend(member.subscriptionIds[0]!)).status).toBe(201)
  })

  it('refuses adding a suspended member to that community from the edit form', async () => {
    await block(swing.id, 'Chargeback')

    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: member.name, phone: member.phone, email: member.email, newCommunity: { communityId: swing.id, payment: 500, validUntil: daysFromNow(60) } })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('COMMUNITY_BLOCKED')
    expect(res.body.message).toContain('Revoke the suspension first')
  })

  it('refuses reviving a member into the community they are suspended from', async () => {
    await block(swing.id, 'Chargeback')
    await prisma.user.update({ where: { id: member.id }, data: { status: 'suspended', suspensionReason: 'Chargeback' } })

    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send({ name: member.name, phone: member.phone, communityId: swing.id, payment: 500, validUntil: daysFromNow(60) })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('COMMUNITY_BLOCKED')
    expect(res.body.message).toContain('Revoke the suspension first')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('suspended')
  })

  it('reports an import row for a suspended member instead of re-adding them', async () => {
    await block(swing.id, 'Chargeback')

    const res = await request(app)
      .post('/api/v1/admin/import-json')
      .set('Authorization', superAdmin.auth)
      .send({
        strategy: 'overwrite',
        rows: [{ name: member.name, phone: member.phone, email: '', service: 'Swing Traders', payment: 1000, valid: daysFromNow(90) }],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(0)
    expect(res.body.data.errors[0].reason).toBe('Member is suspended from this community — revoke the suspension first')
  })
})
