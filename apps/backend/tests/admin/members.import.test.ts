import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, nextMobile, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// Bulk member import: the CSV upload (/import-csv), the reviewed JSON import (/import-json) and the pre-flight
// check (/validate-import). One bad row must never sink the others, and nobody can import into a community they
// do not manage or onto an admin account.

const app = createApp()

let boss: TestAdmin
let priya: TestAdmin // Swing only
let swing: { id: string; name: string }
let options: { id: string; name: string }

const HEADER = 'Name,Contact Number,Email,Service,Payment,Valid,Paid on'
const csvRow = (o: { name?: string; phone?: string; email?: string; service?: string; payment?: string; valid?: string; paidOn?: string } = {}) =>
  [o.name ?? 'Import Person', o.phone ?? nextMobile(), o.email ?? '', o.service ?? swing.name, o.payment ?? '1000', o.valid ?? daysFromNow(90), o.paidOn ?? daysFromNow(-5)].join(',')
const upload = (a: TestAdmin, rows: string[], strategy: 'skip' | 'overwrite' = 'skip', header = HEADER) =>
  request(app)
    .post(`/api/v1/admin/import-csv?duplicateStrategy=${strategy}`)
    .set('Authorization', a.auth)
    .attach('file', Buffer.from([header, ...rows].join('\n')), { filename: 'members.csv', contentType: 'text/csv' })
const importJson = (a: TestAdmin, rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/admin/import-json').set('Authorization', a.auth).send({ strategy: 'skip', rows, ...extra })
const jrow = (o: Record<string, unknown> = {}) => ({ name: 'Json Person', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: daysFromNow(90), ...o })

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /admin/import-csv', () => {
  it('creates members with an approved phone and a subscription, and reports totals', async () => {
    const phone = nextMobile()
    const res = await upload(boss, [csvRow({ phone, name: 'Asha Rao', email: 'ASHA@import.test' }), csvRow()])
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ total: 2, created: 2, updated: 0, skipped: 0, errors: [] })
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } })
    expect(user).toMatchObject({ name: 'Asha Rao', email: 'asha@import.test', role: 'member' })
    expect(await prisma.approvedPhone.count({ where: { phone } })).toBe(1)
    expect(await prisma.subscription.count({ where: { userId: user.id, communityId: swing.id, isActive: true } })).toBe(1)
  })

  it('reports each bad row and still imports the good ones', async () => {
    const res = await upload(boss, [
      csvRow(),
      csvRow({ phone: '12345' }),
      csvRow({ service: 'No Such Community' }),
      csvRow({ payment: '-5' }),
      csvRow({ payment: 'abc' }),
      csvRow({ valid: 'not a date' }),
      csvRow({ email: 'not-an-email' }),
      csvRow(),
    ])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(2)
    expect(res.body.data.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('does not abort the whole file when a row\'s email already belongs to someone else', async () => {
    const owner = await createMobileMember({ email: 'taken@import.test', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const res = await upload(boss, [csvRow({ name: 'First Good' }), csvRow({ email: owner.email! }), csvRow({ name: 'Third Good' })])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(2)
    expect(res.body.data.errors).toHaveLength(1)
    expect(res.body.data.errors[0].row).toBe(3)
  })

  it('does not abort the file when the same email appears on two rows', async () => {
    const res = await upload(boss, [csvRow({ email: 'dup@import.test' }), csvRow({ email: 'dup@import.test' }), csvRow()])
    expect(res.status).toBe(200)
    expect(res.body.data.created + res.body.data.errors.length).toBeGreaterThanOrEqual(3)
    expect(await prisma.user.count({ where: { email: 'dup@import.test' } })).toBe(1)
  })

  it('rejects a row whose name or email is longer than the database allows, instead of failing the file', async () => {
    const res = await upload(boss, [csvRow({ name: 'N'.repeat(150) }), csvRow()])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(1)
    expect(res.body.data.errors[0].row).toBe(2)
  })

  it('never turns an admin account into a member: a row with an admin\'s phone is an error', async () => {
    const adminRow = await prisma.user.findUniqueOrThrow({ where: { id: priya.id } })
    const res = await upload(boss, [csvRow({ phone: adminRow.phone, name: 'Takeover', email: 'takeover@import.test' })], 'overwrite')
    expect(res.status).toBe(200)
    expect(res.body.data.errors).toHaveLength(1)
    expect(await prisma.subscription.count({ where: { userId: priya.id } })).toBe(0)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: priya.id } })
    expect(after.name).toBe(adminRow.name)
  })

  it('refuses a deleted community by name, the same as the pre-flight check does', async () => {
    await prisma.community.update({ where: { id: options.id }, data: { deletedAt: new Date() } })
    const res = await upload(boss, [csvRow({ service: options.name })])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(0)
    expect(res.body.data.errors).toHaveLength(1)
  })

  it('accepts a phone in any common format and stores the normalised one', async () => {
    const res = await upload(boss, [csvRow({ phone: '98111 22222' }), csvRow({ phone: '+91-98111-33333' }), csvRow({ phone: '09811144444' })])
    expect(res.body.data.created).toBe(3)
    expect((await prisma.user.findMany({ where: { phone: { in: ['+919811122222', '+919811133333', '+919811144444'] } } })).length).toBe(3)
  })

  describe('duplicates', () => {
    it('skip leaves an existing active subscription alone', async () => {
      const m = await createMobileMember({ name: 'Existing', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(10), payment: 500 }] })
      const res = await upload(boss, [csvRow({ phone: m.phone, payment: '9999', valid: daysFromNow(400) })], 'skip')
      expect(res.body.data).toMatchObject({ skipped: 1, created: 0, updated: 0 })
      const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: m.id } })
      expect(Number(sub.payment)).toBe(500)
    })

    it('overwrite updates the subscription dates and payment, and a registered member\'s own name is kept', async () => {
      const m = await createMobileMember({ name: 'Registered Name', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(10), payment: 500 }] })
      const res = await upload(boss, [csvRow({ phone: m.phone, name: 'Sheet Name', payment: '9999', valid: daysFromNow(400) })], 'overwrite')
      expect(res.body.data.updated).toBe(1)
      const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: m.id } })
      expect(Number(sub.payment)).toBe(9999)
      expect((await prisma.user.findUniqueOrThrow({ where: { id: m.id } })).name).toBe('Registered Name')
    })

    it('the same phone twice in one file creates one member (the second row is skipped)', async () => {
      const phone = nextMobile()
      const res = await upload(boss, [csvRow({ phone }), csvRow({ phone })])
      expect(res.body.data).toMatchObject({ created: 1, skipped: 1 })
      expect(await prisma.user.count({ where: { phone } })).toBe(1)
    })

    it('adds a second community to an existing member without touching the first', async () => {
      const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      const res = await upload(boss, [csvRow({ phone: m.phone, service: options.name })])
      expect(res.body.data.created).toBe(1)
      expect(await prisma.subscription.count({ where: { userId: m.id, isActive: true } })).toBe(2)
    })

    it('does not quietly reactivate a suspended member, and does not touch a member of another community', async () => {
      const s = await createMobileMember({ status: 'suspended', suspensionReason: 'spam', subscriptions: [{ communityId: options.id, validUntil: daysFromNow(30) }] })
      const res = await upload(priya, [csvRow({ phone: s.phone, service: swing.name })])
      expect(res.body.data.errors).toHaveLength(1)
      expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('suspended')
      expect(await prisma.subscription.count({ where: { userId: s.id, communityId: swing.id } })).toBe(0)
    })
  })

  describe('a community admin', () => {
    it('can import into their own community only', async () => {
      const res = await upload(priya, [csvRow({ service: swing.name }), csvRow({ service: options.name })])
      expect(res.body.data.created).toBe(1)
      expect(res.body.data.errors).toHaveLength(1)
      expect(res.body.data.errors[0].reason).toMatch(/access/i)
      expect(await prisma.subscription.count({ where: { communityId: options.id } })).toBe(0)
    })

    it('cannot overwrite a subscription in a community they do not manage', async () => {
      const m = await createMobileMember({ subscriptions: [{ communityId: options.id, validUntil: daysFromNow(10), payment: 500 }] })
      await upload(priya, [csvRow({ phone: m.phone, service: options.name, payment: '1' })], 'overwrite')
      const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: m.id } })
      expect(Number(sub.payment)).toBe(500)
    })
  })

  describe('bad uploads', () => {
    it('answers 400 when there is no file', async () => {
      expect((await request(app).post('/api/v1/admin/import-csv').set('Authorization', boss.auth)).status).toBe(400)
    })

    it('answers 400 for a file of the wrong type', async () => {
      const res = await request(app).post('/api/v1/admin/import-csv').set('Authorization', boss.auth).attach('file', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' })
      expect(res.status).toBe(400)
    })

    it('answers 4xx (not 500) for a file that is too big', async () => {
      const big = Buffer.alloc(6 * 1024 * 1024, 'a')
      const res = await request(app).post('/api/v1/admin/import-csv').set('Authorization', boss.auth).attach('file', big, { filename: 'big.csv', contentType: 'text/csv' })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('answers 4xx or a per-row error report (never a 500) for a file with the wrong columns, or only a header', async () => {
      const wrong = await upload(boss, ['a,b,c'], 'skip', 'Foo,Bar,Baz')
      expect(wrong.status).toBeLessThan(500)
      const empty = await upload(boss, [])
      expect(empty.status).toBeLessThan(500)
      expect(await prisma.user.count({ where: { role: 'member' } })).toBe(0)
    })

    it('handles a spreadsheet-style header with stray spaces and different letter case', async () => {
      const res = await upload(boss, [csvRow()], 'skip', ' Name , Contact Number ,Email,Service, Payment ,Valid ,Paid on')
      expect(res.body.data.created).toBe(1)
    })

    it('refuses a rejected duplicateStrategy value with a 4xx', async () => {
      const res = await request(app).post('/api/v1/admin/import-csv?duplicateStrategy=destroy').set('Authorization', boss.auth).attach('file', Buffer.from(`${HEADER}\n${csvRow()}`), { filename: 'm.csv', contentType: 'text/csv' })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('rejects an unauthenticated upload and a mobile member', async () => {
      const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      expect((await request(app).post('/api/v1/admin/import-csv').attach('file', Buffer.from('x'), { filename: 'm.csv', contentType: 'text/csv' })).status).toBe(401)
      expect((await request(app).post('/api/v1/admin/import-csv').set('Cookie', `mobile_session_id=${m.sessionId}`).attach('file', Buffer.from('x'), { filename: 'm.csv', contentType: 'text/csv' })).status).toBe(403)
    })
  })
})

describe('POST /admin/import-json and /validate-import', () => {
  it('imports reviewed rows', async () => {
    const res = await importJson(boss, [jrow(), jrow()])
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ total: 2, created: 2, errors: [] })
  })

  it('does not abort the batch for a row whose email belongs to someone else', async () => {
    const owner = await createMobileMember({ email: 'taken2@import.test', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const res = await importJson(boss, [jrow(), jrow({ email: owner.email }), jrow()])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(2)
    expect(res.body.data.errors).toHaveLength(1)
  })

  it('refuses rows for a community a community admin does not manage', async () => {
    const res = await importJson(priya, [jrow({ service: options.name })])
    expect(res.body.data.created).toBe(0)
    expect(res.body.data.errors).toHaveLength(1)
  })

  it('never turns an admin into a member', async () => {
    const adminRow = await prisma.user.findUniqueOrThrow({ where: { id: priya.id } })
    const res = await importJson(boss, [jrow({ phone: adminRow.phone })], { strategy: 'overwrite' })
    expect(res.body.data.errors).toHaveLength(1)
    expect(await prisma.subscription.count({ where: { userId: priya.id } })).toBe(0)
  })

  it('rejects an empty batch, an unknown strategy and a payment of zero with a 4xx', async () => {
    expect((await importJson(boss, [])).status).toBe(422)
    expect((await importJson(boss, [jrow()], { strategy: 'nuke' })).status).toBeGreaterThanOrEqual(400)
    const zero = await importJson(boss, [jrow({ payment: 0 })])
    expect(zero.status).toBeGreaterThanOrEqual(400)
    expect(zero.status).toBeLessThan(500)
  })

  it('does not revive a suspended or deleted member unless the admin ticked that row', async () => {
    const d = await createMobileMember({ status: 'deleted', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-30), isActive: false }] })
    const skipped = await importJson(boss, [jrow({ phone: d.phone })])
    expect((await prisma.user.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('deleted')
    expect(skipped.status).toBe(200)
    const revived = await importJson(boss, [jrow({ phone: d.phone })], { reviveRowNums: [1] })
    expect(revived.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('active')
  })

  it('validate-import flags bad rows, existing phones and other-community rows without writing anything', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const res = await request(app).post('/api/v1/admin/validate-import').set('Authorization', priya.auth).send({
      rows: [
        { rowNum: 1, name: 'Ok Person', phone: nextMobile(), email: '', service: swing.name, payment: 100, valid: daysFromNow(30) },
        { rowNum: 2, name: 'Bad Phone', phone: '123', email: '', service: swing.name, payment: 100, valid: daysFromNow(30) },
        { rowNum: 3, name: 'Existing', phone: m.phone, email: '', service: swing.name, payment: 100, valid: daysFromNow(30) },
        { rowNum: 4, name: 'Other Community', phone: nextMobile(), email: '', service: options.name, payment: 100, valid: daysFromNow(30) },
      ],
    })
    expect(res.status).toBe(200)
    const [r1, r2, r3, r4] = res.body.data.results
    expect(r1.errors).toEqual([])
    expect(r2.errors.length).toBeGreaterThan(0)
    expect(r3.isDuplicate).toBe(true)
    expect(r4.errors.length).toBeGreaterThan(0)
    expect(await prisma.user.count({ where: { role: 'member' } })).toBe(1)
  })
})
