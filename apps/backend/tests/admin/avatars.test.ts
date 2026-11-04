import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { mapMessage as mapTicketMessage, messageInclude as ticketMessageInclude } from '../../src/modules/tickets/tickets.shared.js'
import { mapMessage as mapServiceMessage, messageInclude as serviceMessageInclude } from '../../src/modules/services/services.shared.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  createTicket,
  createServiceRequest,
  daysFromNow,
  type TestAdmin,
} from '../helpers/fixtures.js'

// Wherever the admin screens show a person, the profile picture comes with them: the member on the Tickets and
// Services lists and detail pages, whoever an item is assigned to, the sender of a chat message, and the members on the
// dashboard widgets. A person with no picture gets `null`, which the screens turn into their initials.

const app = createApp()

const PRIYA_PIC = 'https://community.finskool21.in/assets/finskool/avatars/priya.jpg'
const SUPPORT_PIC = 'https://community.finskool21.in/assets/finskool/avatars/support.png'

let boss: TestAdmin
let swing: { id: string }
let priya: { id: string } // has a picture
let omar: { id: string } // has none
let support: TestAdmin // an admin with a picture

const get = (path: string) => request(app).get(`/api/v1/admin${path}`).set('Authorization', boss.auth)

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  support = await createAdmin({ isSuperAdmin: true, name: 'Sam Support' })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  priya = await createMobileMember({ name: 'Priya Shah' })
  omar = await createMobileMember({ name: 'Omar Khan' })
  await prisma.user.update({ where: { id: priya.id }, data: { avatarUrl: PRIYA_PIC } })
  await prisma.user.update({ where: { id: support.id }, data: { avatarUrl: SUPPORT_PIC } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('tickets', () => {
  it('the list carries the member\'s and the assignee\'s picture, and null for someone without one', async () => {
    const withPic = await createTicket({ userId: priya.id, communityId: swing.id, subject: 'Has a picture' })
    const without = await createTicket({ userId: omar.id, communityId: swing.id, subject: 'Has none' })
    await prisma.ticket.update({ where: { id: withPic.id }, data: { assignedAdminId: support.id } })

    const res = await get('/tickets')
    expect(res.status).toBe(200)
    const bySubject = Object.fromEntries(res.body.data.items.map((t: { subject: string }) => [t.subject, t]))
    expect(bySubject['Has a picture'].user).toMatchObject({ id: priya.id, name: 'Priya Shah', avatarUrl: PRIYA_PIC })
    expect(bySubject['Has a picture'].assignedAdmin).toEqual({ id: support.id, name: 'Sam Support', avatarUrl: SUPPORT_PIC })
    expect(bySubject['Has none'].user.avatarUrl).toBeNull()
    expect(bySubject['Has none'].assignedAdmin).toBeNull()
    expect(without.id).toBeDefined()
  })

  it('the detail page has them too', async () => {
    const t = await createTicket({ userId: priya.id, communityId: swing.id })
    await prisma.ticket.update({ where: { id: t.id }, data: { assignedAdminId: support.id } })

    const res = await get(`/tickets/${t.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.user.avatarUrl).toBe(PRIYA_PIC)
    expect(res.body.data.assignedAdmin.avatarUrl).toBe(SUPPORT_PIC)
  })

  it('a chat message names its sender\'s picture, for the member and for the admin', async () => {
    const t = await createTicket({ userId: priya.id, communityId: swing.id, repliedBy: support.id })
    const rows = await prisma.ticketMessage.findMany({ where: { ticketId: t.id }, include: ticketMessageInclude, orderBy: { createdAt: 'asc' } })
    const dtos = await Promise.all(rows.map(mapTicketMessage))
    expect(dtos.map(m => [m.senderRole, m.senderAvatarUrl])).toEqual([
      ['user', PRIYA_PIC],
      ['admin', SUPPORT_PIC],
    ])
  })

  it('a sender without a picture is null', async () => {
    const t = await createTicket({ userId: omar.id, communityId: swing.id })
    const row = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: t.id }, include: ticketMessageInclude })
    expect((await mapTicketMessage(row)).senderAvatarUrl).toBeNull()
  })
})

describe('services', () => {
  it('the list and detail carry the member\'s and the assignee\'s picture', async () => {
    const r = await createServiceRequest({ userId: priya.id, repliedBy: support.id })
    await prisma.serviceRequest.update({ where: { id: r.id }, data: { assignedAdminId: support.id } })
    await createServiceRequest({ userId: omar.id, repliedBy: support.id, title: 'Another service' })

    const list = await get('/services')
    expect(list.status).toBe(200)
    const byUser = Object.fromEntries(list.body.data.items.map((i: { user: { name: string } }) => [i.user.name, i]))
    expect(byUser['Priya Shah'].user.avatarUrl).toBe(PRIYA_PIC)
    expect(byUser['Priya Shah'].assignedAdmin).toEqual({ id: support.id, name: 'Sam Support', avatarUrl: SUPPORT_PIC })
    expect(byUser['Omar Khan'].user.avatarUrl).toBeNull()

    const detail = await get(`/services/${r.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.user.avatarUrl).toBe(PRIYA_PIC)
    expect(detail.body.data.assignedAdmin.avatarUrl).toBe(SUPPORT_PIC)
  })

  it('a chat message names its sender\'s picture, and a system message has none', async () => {
    const r = await createServiceRequest({ userId: priya.id, repliedBy: support.id })
    await prisma.serviceMessage.create({
      data: { requestId: r.id, senderId: priya.id, senderRole: 'user', kind: 'text', body: 'Hello', clientMessageId: 'c-1' },
    })
    await prisma.serviceMessage.create({
      data: { requestId: r.id, senderId: null, senderRole: 'system', kind: 'system', body: 'Request closed', clientMessageId: null },
    })

    const rows = await prisma.serviceMessage.findMany({ where: { requestId: r.id }, include: serviceMessageInclude, orderBy: { createdAt: 'asc' } })
    const dtos = await Promise.all(rows.map(mapServiceMessage))
    const pictureBy = (role: string) => dtos.filter(m => m.senderRole === role).map(m => m.senderAvatarUrl)
    expect(pictureBy('user')).toContain(PRIYA_PIC)
    expect(pictureBy('admin')).toContain(SUPPORT_PIC)
    expect(pictureBy('system')).toEqual([null])
  })
})

describe('dashboard widgets', () => {
  it('expiring subscriptions carry the member\'s picture', async () => {
    await prisma.subscription.create({
      data: { userId: priya.id, communityId: swing.id, payment: 999, paidOn: new Date(daysFromNow(-20)), validUntil: new Date(daysFromNow(3)), isActive: true },
    })
    await prisma.subscription.create({
      data: { userId: omar.id, communityId: swing.id, payment: 999, paidOn: new Date(daysFromNow(-20)), validUntil: new Date(daysFromNow(4)), isActive: true },
    })

    const res = await get('/dashboard/expiring')
    expect(res.status).toBe(200)
    const byName = Object.fromEntries(res.body.data.items.map((i: { name: string }) => [i.name, i]))
    expect(byName['Priya Shah']).toMatchObject({ initials: 'PS', avatarUrl: PRIYA_PIC })
    expect(byName['Omar Khan']).toMatchObject({ initials: 'OK', avatarUrl: null })
  })

  it('new registrations carry the member\'s picture', async () => {
    const res = await get('/dashboard/registrations')
    expect(res.status).toBe(200)
    const byName = Object.fromEntries(res.body.data.items.map((i: { name: string }) => [i.name, i]))
    expect(byName['Priya Shah'].avatarUrl).toBe(PRIYA_PIC)
    expect(byName['Omar Khan'].avatarUrl).toBeNull()
  })

  it('recent tickets and enquiries carry the member\'s picture', async () => {
    await createTicket({ userId: priya.id, communityId: swing.id })
    await createServiceRequest({ userId: omar.id, repliedBy: support.id })

    const res = await get('/dashboard/tickets')
    expect(res.status).toBe(200)
    const byKind = Object.fromEntries(res.body.data.items.map((i: { kind: string }) => [i.kind, i]))
    expect(byKind['support'].member).toMatchObject({ name: 'Priya Shah', avatarUrl: PRIYA_PIC })
    expect(byKind['service'].member).toMatchObject({ name: 'Omar Khan', avatarUrl: null })
  })
})
