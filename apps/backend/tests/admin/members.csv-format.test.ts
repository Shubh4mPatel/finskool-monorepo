import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { notificationsQueue, WELCOME_EMAIL_JOB } from '../../src/lib/queue.js'
import { parseStrictDate, todayInIndia, subscriptionDatesProblem } from '../../src/modules/admin/admin.service.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, nextMobile, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// Members > Export CSV and Import CSV share one format: the same column names, a plain payment, YYYY-MM-DD dates.
// Dates are checked strictly (the exact format or the row is refused, nothing is guessed), a duplicate is a
// (phone, community) pair, and the free community can be imported at price 0 with no valid-till date.

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)
const XLSX = createRequire(import.meta.url)('xlsx') as {
  utils: { aoa_to_sheet(rows: unknown[][], opts?: object): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void }
  write(wb: unknown, opts: object): Buffer
}

let boss: TestAdmin
let swing: { id: string; name: string }
let options: { id: string; name: string }
let free: { id: string; name: string }

// The importer's own column names, in the order the export writes them.
const HEADER = 'Name,Contact Number,Payment,Paid on,Valid,Service,Email'
type Row = { name?: string; phone?: string; payment?: string; paidOn?: string; valid?: string; service?: string; email?: string }
const csvRow = (o: Row = {}) =>
  [o.name ?? 'Import Person', o.phone ?? nextMobile(), o.payment ?? '1000', o.paidOn ?? daysFromNow(-5), o.valid ?? daysFromNow(90), o.service ?? swing.name, o.email ?? ''].join(',')
const uploadText = (text: string, strategy: 'skip' | 'overwrite' = 'overwrite') =>
  request(app)
    .post(`/api/v1/admin/import-csv?duplicateStrategy=${strategy}`)
    .set('Authorization', boss.auth)
    .attach('file', Buffer.from(text), { filename: 'members.csv', contentType: 'text/csv' })
const upload = (rows: string[], strategy: 'skip' | 'overwrite' = 'overwrite') => uploadText([HEADER, ...rows].join('\n'), strategy)
const validate = (rows: Array<Record<string, unknown>>) =>
  request(app)
    .post('/api/v1/admin/validate-import')
    .set('Authorization', boss.auth)
    .send({ rows: rows.map((r, i) => ({ rowNum: i + 1, name: 'Person', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: daysFromNow(90), ...r })) })
const importJson = (rows: Array<Record<string, unknown>>) =>
  request(app).post('/api/v1/admin/import-json').set('Authorization', boss.auth).send({ strategy: 'overwrite', rows })
const exportCsv = () => request(app).get('/api/v1/admin/members/export').set('Authorization', boss.auth)

const reasons = (res: request.Response) => (res.body.data.errors as { reason: string }[]).map(e => e.reason)
const subsOf = (userId: string, communityId: string) => prisma.subscription.findMany({ where: { userId, communityId } })

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  free = await createCommunity(boss.id, { name: 'Finskool Free', isFree: true })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('parseStrictDate', () => {
  it('accepts exactly YYYY-MM-DD, as UTC midnight', () => {
    expect(parseStrictDate('2026-12-31')?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
    expect(parseStrictDate(' 2027-02-08 ')?.toISOString()).toBe('2027-02-08T00:00:00.000Z')
    expect(parseStrictDate('2028-02-29')).not.toBeNull() // a real leap day
  })

  it.each([
    '15 Jan 2026', '02/08/2027', '2/8/27', '08-02-2027', '2026-2-3', '2026-02-3', '20261231', '2026/12/31',
    '2026-12-31T00:00:00Z', '2026-02-31', '2027-02-29', '2026-13-01', '1999-12-31', 'not a date', '', '46426',
  ])('refuses %j', raw => {
    expect(parseStrictDate(raw)).toBeNull()
  })
})

describe('dates in an uploaded CSV are checked, never converted', () => {
  it('imports YYYY-MM-DD and stores that exact day', async () => {
    const phone = nextMobile()
    const res = await upload([csvRow({ phone, paidOn: '2026-11-05', valid: '2027-02-08' })])

    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } })
    const [sub] = await subsOf(user.id, swing.id)
    expect(sub!.validUntil!.toISOString().slice(0, 10)).toBe('2027-02-08')
    expect(sub!.paidOn!.toISOString().slice(0, 10)).toBe('2026-11-05')
  })

  it.each(['15 Jan 2027', '02/08/2027', '8-2-2027', '2027-2-8', '2027-02-30'])('refuses a Valid of %s and creates nothing', async valid => {
    const res = await upload([csvRow({ valid })])

    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual([`Valid must be YYYY-MM-DD (got "${valid}")`])
    expect(await prisma.subscription.count({ where: { communityId: swing.id } })).toBe(0)
  })

  it('refuses a missing Valid date on a paid community', async () => {
    const res = await upload([csvRow({ valid: '' })])
    expect(reasons(res)).toEqual(['Valid must be YYYY-MM-DD (it is empty)'])
  })

  it('refuses a Paid on in another format instead of silently dropping it', async () => {
    const res = await upload([csvRow({ paidOn: '5 Nov 2026' })])

    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual(['Paid on must be YYYY-MM-DD (got "5 Nov 2026")'])
  })

  it('leaves Paid on optional', async () => {
    const res = await upload([csvRow({ paidOn: '' })])
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
  })

  it('reads a phone written with a leading + as text', async () => {
    const phone = '+919876543210'
    const res = await upload([csvRow({ phone })])
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    expect(await prisma.user.findUnique({ where: { phone } })).not.toBeNull()
  })
})

describe('dates typed as dates in an .xlsx file', () => {
  const xlsxWith = (valid: Date) => {
    const ws = XLSX.utils.aoa_to_sheet(
      [
        ['Name', 'Contact Number', 'Payment', 'Paid on', 'Valid', 'Service', 'Email'],
        ['Xlsx Person', '+919812345678', 1500, new Date(Date.UTC(2026, 10, 5)), valid, swing.name, ''],
      ],
      { cellDates: true },
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Members')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })
  }

  it('are read as the same calendar day, whatever timezone the server runs in', async () => {
    const res = await request(app)
      .post('/api/v1/admin/import-csv?duplicateStrategy=skip')
      .set('Authorization', boss.auth)
      .attach('file', xlsxWith(new Date(Date.UTC(2027, 1, 8))), {
        filename: 'members.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919812345678' } })
    const [sub] = await subsOf(user.id, swing.id)
    expect(sub!.validUntil!.toISOString().slice(0, 10)).toBe('2027-02-08')
    expect(sub!.paidOn!.toISOString().slice(0, 10)).toBe('2026-11-05')
  })
})

describe('the free community in an import', () => {
  it('accepts a row at price 0 with no valid-till date, and gives the member exactly one free subscription', async () => {
    const phone = nextMobile()
    const res = await upload([csvRow({ phone, service: free.name, payment: '0', valid: '', paidOn: '', email: 'free@example.com' })])

    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } })
    const subs = await subsOf(user.id, free.id)
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ isActive: true, validUntil: null })
    // No expiry to state, so no welcome email (the same rule as adding a member to the free community by hand).
    expect(queueAdd.mock.calls.filter(([n]) => n === WELCOME_EMAIL_JOB)).toHaveLength(0)
  })

  it('treats a blank Payment as 0 for the free community', async () => {
    const res = await upload([csvRow({ service: free.name, payment: '', valid: '', paidOn: '' })])
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
  })

  it('refuses a price for the free community', async () => {
    const res = await upload([csvRow({ service: free.name, payment: '500', valid: '' })])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual(['The free community has no price: leave Payment blank or 0'])
  })

  it('still refuses 0 or a blank payment for a paid community', async () => {
    const res = await upload([csvRow({ payment: '0' }), csvRow({ payment: '' })])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual(['Invalid payment amount', 'Invalid payment amount'])
  })

  it('skips a member who already has the free community, and never adds a second row', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    await prisma.subscription.create({ data: { userId: m.id, communityId: free.id, payment: 0, validUntil: null } })

    const res = await upload([csvRow({ phone: m.phone, service: free.name, payment: '0', valid: '', paidOn: '' })], 'overwrite')

    expect(res.body.data).toMatchObject({ created: 0, updated: 0, skipped: 1, errors: [] })
    expect(await subsOf(m.id, free.id)).toHaveLength(1)
  })

  it('adds the free community to an existing member who somehow lacks it, without a duplicate', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const res = await upload([csvRow({ phone: m.phone, service: free.name, payment: '0', valid: '', paidOn: '' })])

    expect(res.body.data.errors).toEqual([])
    expect(await subsOf(m.id, free.id)).toHaveLength(1)
  })

  it('works the same through the reviewed-rows import', async () => {
    const phone = nextMobile()
    const res = await importJson([{ name: 'Json Free', phone, email: '', service: free.name, payment: 0, valid: '' }])

    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    expect(await subsOf((await prisma.user.findUniqueOrThrow({ where: { phone } })).id, free.id)).toHaveLength(1)
  })
})

describe('the reviewed-rows import and the preview apply the same rules', () => {
  it('import-json refuses a date in another format', async () => {
    const res = await importJson([{ name: 'Json Person', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: '15 Jan 2027' }])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual(['Valid must be YYYY-MM-DD (got "15 Jan 2027")'])
  })

  it('validate-import flags the date format, which it used to let through', async () => {
    const res = await validate([{ valid: '15 Jan 2027' }, { valid: '2027-02-30' }, { paidOn: '5 Nov 2026' }, {}])
    const errors = (res.body.data.results as { errors: string[] }[]).map(r => r.errors)

    expect(errors[0]).toEqual(['Valid must be YYYY-MM-DD (got "15 Jan 2027")'])
    expect(errors[1]).toEqual(['Valid must be YYYY-MM-DD (got "2027-02-30")'])
    expect(errors[2]).toEqual(['Paid on must be YYYY-MM-DD (got "5 Nov 2026")'])
    expect(errors[3]).toEqual([])
  })

  it('validate-import accepts a free row at price 0 with no valid date, and refuses a price', async () => {
    const res = await validate([
      { service: free.name, payment: 0, valid: '' },
      { service: free.name, payment: 500, valid: '' },
      { service: swing.name, payment: 0 },
    ])
    const errors = (res.body.data.results as { errors: string[] }[]).map(r => r.errors)

    expect(errors[0]).toEqual([])
    expect(errors[1]).toEqual(['The free community has no price: leave Payment blank or 0'])
    expect(errors[2]).toEqual(['Invalid payment amount'])
  })
})

describe('what counts as a duplicate: the same phone in the same community', () => {
  let member: TestMobileMemberLite

  type TestMobileMemberLite = { id: string; phone: string }

  beforeEach(async () => {
    member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
  })

  it('preview: a phone already in that community is a duplicate', async () => {
    const res = await validate([{ phone: member.phone, service: swing.name }])
    const [r] = res.body.data.results as { isDuplicate: boolean; warnings: string[] }[]

    expect(r!.isDuplicate).toBe(true)
    expect(r!.warnings[0]).toContain(`Already a member of ${swing.name}`)
  })

  it('preview: the same phone in ANOTHER community is not a duplicate, it is being added', async () => {
    const res = await validate([{ phone: member.phone, service: options.name }])
    const [r] = res.body.data.results as { isDuplicate: boolean; warnings: string[] }[]

    expect(r!.isDuplicate).toBe(false)
    expect(r!.warnings).toEqual([`Existing member — will be added to ${options.name}`])
  })

  it('preview: a self-registered member (no approved-phone row) is recognised too', async () => {
    const self = await createMobileMember({ source: 'self', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const res = await validate([{ phone: self.phone, service: swing.name }])
    expect((res.body.data.results as { isDuplicate: boolean }[])[0]!.isDuplicate).toBe(true)
  })

  it('preview: the same phone and community twice in one file flags the second row only', async () => {
    const phone = nextMobile()
    const res = await validate([{ phone, service: swing.name }, { phone, service: swing.name }, { phone, service: options.name }])
    const flags = (res.body.data.results as { isDuplicate: boolean }[]).map(r => r.isDuplicate)

    expect(flags).toEqual([false, true, false])
  })

  it('import: the same phone in two communities is one member with two subscriptions', async () => {
    const phone = nextMobile()
    const res = await upload([csvRow({ phone, service: swing.name }), csvRow({ phone, service: options.name })])

    expect(res.body.data).toMatchObject({ created: 2, updated: 0, skipped: 0, errors: [] })
    expect(await prisma.user.count({ where: { phone } })).toBe(1)
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } })
    expect(await subsOf(user.id, swing.id)).toHaveLength(1)
    expect(await subsOf(user.id, options.id)).toHaveLength(1)
  })

  it('import: the same phone and community twice follows the strategy (skip keeps the first, overwrite updates it)', async () => {
    const phone = nextMobile()
    const skip = await upload([csvRow({ phone, payment: '1000' }), csvRow({ phone, payment: '2000' })], 'skip')
    expect(skip.body.data).toMatchObject({ created: 1, skipped: 1 })
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } })
    expect(Number((await subsOf(user.id, swing.id))[0]!.payment)).toBe(1000)

    const overwrite = await upload([csvRow({ phone, payment: '3000' })], 'overwrite')
    expect(overwrite.body.data).toMatchObject({ created: 0, updated: 1 })
    const subs = await subsOf(user.id, swing.id)
    expect(subs).toHaveLength(1)
    expect(Number(subs[0]!.payment)).toBe(3000)
  })
})

describe('export and import use the same format', () => {
  it('an exported file imports again with no errors, and adds no duplicate subscriptions', async () => {
    const paid = await createMobileMember({
      name: 'Asha "Ace" Nair',
      email: 'asha@example.com',
      subscriptions: [
        { communityId: swing.id, validUntil: '2030-03-31', paidOn: '2026-01-15', payment: 12500 },
        { communityId: options.id, validUntil: '2030-01-31', paidOn: '2026-01-10', payment: 999 },
      ],
    })
    const freeOnly = await createMobileMember({ name: 'Free Farhan', email: null, subscriptions: [] })
    for (const m of [paid, freeOnly]) {
      await prisma.subscription.create({ data: { userId: m.id, communityId: free.id, payment: 0, validUntil: null } })
    }

    const exported = await exportCsv()
    const [header, ...lines] = exported.text.slice(1).split('\n')
    expect(header).toBe('"Name","Contact Number","Payment","Paid on","Valid","Service","Email","Status","Added On"')
    // The free community exports as payment 0 with no valid date.
    expect(lines.find(l => l.includes('Free Farhan'))).toContain('"0","","","Finskool Free"')
    expect(lines.find(l => l.includes('Swing Traders'))).toContain('"12500","2026-01-15","2030-03-31","Swing Traders"')

    const res = await uploadText(exported.text, 'overwrite')

    expect(res.status).toBe(200)
    expect(res.body.data.errors).toEqual([])
    expect(res.body.data).toMatchObject({ total: 4, updated: 2, skipped: 2, created: 0 })
    // Nothing duplicated, nothing changed.
    expect(await subsOf(paid.id, swing.id)).toHaveLength(1)
    expect(await subsOf(paid.id, free.id)).toHaveLength(1)
    expect(await subsOf(freeOnly.id, free.id)).toHaveLength(1)
    const [swingSub] = await subsOf(paid.id, swing.id)
    expect(Number(swingSub!.payment)).toBe(12500)
    expect(swingSub!.validUntil!.toISOString().slice(0, 10)).toBe('2030-03-31')
  })

  it('the same exported file also passes the preview (validate-import) rows without errors', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: '2030-03-31', paidOn: '2026-01-15', payment: 12500 }] })
    await prisma.subscription.create({ data: { userId: m.id, communityId: free.id, payment: 0, validUntil: null } })

    const exported = await exportCsv()
    const [, ...lines] = exported.text.slice(1).split('\n')
    const cells = lines.map(l => l.slice(1, -1).split('","'))
    const rows = cells.map((c, i) => ({ rowNum: i + 1, name: c[0], phone: c[1], payment: Number(c[2] || 0), paidOn: c[3] || undefined, valid: c[4], service: c[5], email: c[6] }))
    const res = await request(app).post('/api/v1/admin/validate-import').set('Authorization', boss.auth).send({ rows })

    expect((res.body.data.results as { errors: string[] }[]).flatMap(r => r.errors)).toEqual([])
  })
})

// ─── Order of the dates: Paid on is today or earlier, Valid is after today and after Paid on ───────────────────────

/** `YYYY-MM-DD` for India's today shifted by `days`, the day the rules are measured from. */
const day = (days = 0) => {
  const d = todayInIndia()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('subscriptionDatesProblem', () => {
  const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
  const today = at('2026-11-10')

  it('accepts today or any earlier Paid on, with a Valid after both', () => {
    expect(subscriptionDatesProblem(at('2026-11-10'), at('2026-11-11'), today)).toBeNull()
    expect(subscriptionDatesProblem(at('2025-01-01'), at('2027-01-01'), today)).toBeNull()
    expect(subscriptionDatesProblem(null, at('2026-11-11'), today)).toBeNull()
    expect(subscriptionDatesProblem(at('2026-11-10'), null, today)).toBeNull() // free community: no Valid
  })

  it('refuses a future Paid on', () => {
    expect(subscriptionDatesProblem(at('2026-11-11'), at('2027-01-01'), today)).toBe('Paid on cannot be in the future (got 2026-11-11); use today or an earlier day')
  })

  it('refuses a Valid that is today or earlier', () => {
    expect(subscriptionDatesProblem(null, at('2026-11-10'), today)).toBe('Valid must be after today (got 2026-11-10)')
    expect(subscriptionDatesProblem(null, at('2026-11-09'), today)).toBe('Valid must be after today (got 2026-11-09)')
  })
})

describe('the import checks the order of the dates', () => {
  it('accepts Paid on today and in the past, with Valid after it', async () => {
    const res = await upload([csvRow({ paidOn: day(0), valid: day(60) }), csvRow({ paidOn: day(-30), valid: day(60) }), csvRow({ paidOn: '', valid: day(1) })])
    expect(res.body.data).toMatchObject({ created: 3, errors: [] })
  })

  it('refuses a Paid on in the future', async () => {
    const res = await upload([csvRow({ paidOn: day(5), valid: day(60) })])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual([`Paid on cannot be in the future (got ${day(5)}); use today or an earlier day`])
  })

  it('refuses a Valid that is today or already past', async () => {
    const res = await upload([csvRow({ paidOn: '', valid: day(0) }), csvRow({ paidOn: '', valid: day(-10) })])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual([`Valid must be after today (got ${day(0)})`, `Valid must be after today (got ${day(-10)})`])
  })

  it('a Valid on or before Paid on is refused (it is not after today either)', async () => {
    const res = await upload([csvRow({ paidOn: day(-2), valid: day(-2) }), csvRow({ paidOn: day(-2), valid: day(-3) })])
    expect(res.body.data.created).toBe(0)
    expect(reasons(res)).toEqual([`Valid must be after today (got ${day(-2)})`, `Valid must be after today (got ${day(-3)})`])
  })

  it('refuses a Paid on in the future even for the free community', async () => {
    const res = await upload([csvRow({ service: free.name, payment: '0', paidOn: day(3), valid: '' })])
    expect(reasons(res)).toEqual([`Paid on cannot be in the future (got ${day(3)}); use today or an earlier day`])
  })

  it('applies to the reviewed-rows import too', async () => {
    const res = await importJson([
      { name: 'A', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: day(-1) },
      { name: 'B', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: day(60), paidOn: day(2) },
      { name: 'C', phone: nextMobile(), email: '', service: swing.name, payment: 1000, valid: day(60), paidOn: day(-1) },
    ])
    expect(res.body.data.created).toBe(1)
    expect(reasons(res)).toEqual([`Valid must be after today (got ${day(-1)})`, `Paid on cannot be in the future (got ${day(2)}); use today or an earlier day`])
  })

  it('and to the preview, so the problem shows before anything is saved', async () => {
    const res = await validate([{ valid: day(-1) }, { paidOn: day(4) }, { paidOn: day(-3), valid: day(30) }])
    const errors = (res.body.data.results as { errors: string[] }[]).map(r => r.errors)

    expect(errors[0]).toEqual([`Valid must be after today (got ${day(-1)})`])
    expect(errors[1]).toEqual([`Paid on cannot be in the future (got ${day(4)}); use today or an earlier day`])
    expect(errors[2]).toEqual([])
  })
})

describe('the same order of dates when an admin adds or changes one member', () => {
  it('add member: Valid must be after today', async () => {
    const add = (validUntil: string) =>
      request(app).post('/api/v1/admin/members').set('Authorization', boss.auth)
        .send({ name: 'Added Person', phone: nextMobile(), communityId: swing.id, payment: 1000, validUntil })

    const past = await add(day(-1))
    expect(past.status).toBe(400)
    expect(past.body.message).toBe(`Valid must be after today (got ${day(-1)})`)
    expect((await add(day(0))).status).toBe(400)
    expect((await add(day(30))).status).toBe(201)
  })

  it('edit member, adding a community: Paid on cannot be future, Valid must be after Paid on and today', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const addCommunity = (newCommunity: Record<string, unknown>) =>
      request(app).patch(`/api/v1/admin/members/${m.id}`).set('Authorization', boss.auth)
        .send({ name: m.name, phone: m.phone, email: m.email, newCommunity: { communityId: options.id, payment: 500, ...newCommunity } })

    expect((await addCommunity({ paidOn: day(3), validUntil: day(60) })).body.message).toBe(`Paid on cannot be in the future (got ${day(3)}); use today or an earlier day`)
    expect((await addCommunity({ validUntil: day(-5) })).status).toBe(400)
    expect((await addCommunity({ paidOn: day(-10), validUntil: day(60) })).status).toBe(200)
  })

  it('extend: an explicit Paid on cannot be in the future, and the new end date must be after today', async () => {
    const m = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    const extend = (body: Record<string, unknown>) =>
      request(app).post(`/api/v1/admin/subscriptions/${m.subscriptionIds[0]}/extend`).set('Authorization', boss.auth).send({ payment: 1000, ...body })

    expect((await extend({ validUntil: day(60), paidOn: day(2) })).body.message).toBe(`Paid on cannot be in the future (got ${day(2)}); use today or an earlier day`)
    expect((await extend({ validUntil: day(-3) })).status).toBe(400)
    expect((await extend({ validUntil: day(60), paidOn: day(-4) })).status).toBe(201)
  })
})
