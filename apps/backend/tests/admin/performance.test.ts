import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// The admin Performance API: linking a board to a community, adding / editing / uploading trades, the numbers
// computed from them, and who may touch which community. Free-member visibility has its own mobile suite.

const app = createApp()

let boss: TestAdmin
let priya: TestAdmin // Swing only
let swing: { id: string }
let intraday: { id: string }
let investor: { id: string }

const api = (a: TestAdmin) => ({
  get: (url: string) => request(app).get(`/api/v1/admin/performance${url}`).set('Authorization', a.auth),
  post: (url: string, body?: object) => request(app).post(`/api/v1/admin/performance${url}`).set('Authorization', a.auth).send(body ?? {}),
  patch: (url: string, body?: object) => request(app).patch(`/api/v1/admin/performance${url}`).set('Authorization', a.auth).send(body ?? {}),
  del: (url: string) => request(app).delete(`/api/v1/admin/performance${url}`).set('Authorization', a.auth),
})

const link = (communityId: string, kind: string) => api(boss).post('/boards', { communityId, kind })

const swingRow = (over: Record<string, unknown> = {}) => ({
  tradeDate: '2026-08-12',
  name: 'BLS International',
  symbol: 'BLS',
  entryPrice: 262,
  cmp: 209.98,
  ...over,
})

const intradayRow = (over: Record<string, unknown> = {}) => ({
  tradeDate: '2026-10-01',
  name: 'Ambuja Cement',
  side: 'buy',
  entryPrice: 368.2,
  exitPrice: 365.7,
  ...over,
})

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Alpha' })
  intraday = await createCommunity(boss.id, { name: 'Intraday Edge' })
  investor = await createCommunity(boss.id, { name: 'Investor Community' })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('boards', () => {
  it('a super admin links a community and it shows up with its segments', async () => {
    expect((await link(swing.id, 'swing')).status).toBe(201)
    expect((await link(investor.id, 'investor')).status).toBe(201)

    const res = await api(boss).get('/boards')
    expect(res.status).toBe(200)
    const boards = res.body.data.boards as { name: string; kind: string; segments: string[] }[]
    expect(boards.map(b => [b.name, b.kind])).toEqual([
      ['Swing Alpha', 'swing'],
      ['Investor Community', 'investor'],
    ])
    expect(boards[1]!.segments).toEqual(['investor', 'long_term', 'us_investment'])
  })

  it('lists the communities a super admin can still link, minus the free one', async () => {
    await createCommunity(boss.id, { name: 'Free', isFree: true })
    await link(swing.id, 'swing')
    const res = await api(boss).get('/boards')
    expect((res.body.data.unlinked as { name: string }[]).map(c => c.name).sort()).toEqual(['Intraday Edge', 'Investor Community'])
  })

  it('only a super admin can link', async () => {
    const res = await api(priya).post('/boards', { communityId: swing.id, kind: 'swing' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('SUPER_ADMIN_REQUIRED')
  })

  it('refuses the free community, a second board, and an unknown community', async () => {
    const free = await createCommunity(boss.id, { name: 'Free', isFree: true })
    expect((await link(free.id, 'swing')).status).toBe(400)

    await link(swing.id, 'swing')
    const again = await link(swing.id, 'intraday')
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('BOARD_EXISTS')

    expect((await link('00000000-0000-4000-8000-000000000000', 'swing')).status).toBe(404)
    expect((await link(intraday.id, 'weekly')).status).toBe(422)
  })

  it('a scoped admin sees only the boards of communities they manage, and nothing to link', async () => {
    await link(swing.id, 'swing')
    await link(intraday.id, 'intraday')
    const res = await api(priya).get('/boards')
    expect((res.body.data.boards as { name: string }[]).map(b => b.name)).toEqual(['Swing Alpha'])
    expect(res.body.data.unlinked).toEqual([])
  })

  it('needs an admin: nobody, and a mobile member, are refused', async () => {
    expect((await request(app).get('/api/v1/admin/performance/boards')).status).toBe(401)
    const member = await createMobileMember()
    const res = await request(app).get('/api/v1/admin/performance/boards').set('Cookie', mobileCookie(member))
    expect(res.status).toBe(403)
  })
})

describe('community scoping', () => {
  beforeEach(async () => {
    await link(swing.id, 'swing')
    await link(intraday.id, 'intraday')
  })

  it('a scoped admin gets 403 on every route of another community', async () => {
    const other = intraday.id
    const calls = [
      api(priya).get(`/communities/${other}/overview`),
      api(priya).get(`/communities/${other}/trades`),
      api(priya).post(`/communities/${other}/trades`, intradayRow()),
      api(priya).post(`/communities/${other}/import`, { rows: [intradayRow()] }),
      api(priya).patch(`/communities/${other}/settings`, { maxFreeTrades: 5 }),
      api(priya).post(`/communities/${other}/periods`, { name: 'Q1', fromMonth: '2026-01', toMonth: '2026-03' }),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('COMMUNITY_ACCESS_DENIED')
    }
  })

  it('a scoped admin works on their own community', async () => {
    expect((await api(priya).post(`/communities/${swing.id}/trades`, swingRow())).status).toBe(201)
    expect((await api(priya).get(`/communities/${swing.id}/overview`)).status).toBe(200)
  })

  it('a community without a board is a 404, and a junk id is a 400', async () => {
    expect((await api(boss).get(`/communities/${investor.id}/overview`)).status).toBe(404)
    expect((await api(boss).get('/communities/not-a-uuid/overview')).status).toBe(400)
  })

  it('a trade id from another board cannot be edited or deleted through this one', async () => {
    const other = await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow())
    const id = other.body.data.id as string
    expect((await api(priya).patch(`/communities/${swing.id}/trades/${id}`, { analysis: 'x' })).status).toBe(404)
    expect((await api(priya).del(`/communities/${swing.id}/trades/${id}`)).status).toBe(404)
  })
})

describe('intraday board', () => {
  const OCT = [
    intradayRow(), // Ambuja buy: -1697 gross, -1837 net
    intradayRow({ tradeDate: '2026-10-05', name: 'CAMS', side: 'sell', entryPrice: 687.55, exitPrice: 682.1 }), // 1982 / 1842
    intradayRow({ tradeDate: '2026-10-07', name: 'IEX', side: 'Sell', entryPrice: 106.9, exitPrice: 106.6 }), // 702 / 562
  ]

  beforeEach(async () => {
    await link(intraday.id, 'intraday')
    const res = await api(boss).post(`/communities/${intraday.id}/import`, { rows: OCT })
    expect(res.body.data.created).toBe(3)
  })

  it('computes each row from the board settings', async () => {
    const res = await api(boss).get(`/communities/${intraday.id}/trades?month=2026-10`)
    const [ambuja, cams] = res.body.data.items
    expect(ambuja).toMatchObject({ serialNo: 1, name: 'Ambuja Cement', side: 'buy', plPerShare: -2.5, plPct: -3.39, grossPnl: -1697, charges: 140, netPnl: -1837 })
    expect(cams).toMatchObject({ serialNo: 2, side: 'sell', plPerShare: 5.45, plPct: 3.96, grossPnl: 1982, netPnl: 1842 })
  })

  it('summarises the whole board and writes the default banner', async () => {
    const res = await api(boss).get(`/communities/${intraday.id}/overview`)
    expect(res.body.data.summary).toMatchObject({
      kind: 'intraday',
      capitalDeployed: 50_000,
      grossPnl: 987,
      totalCharges: 420,
      overallPnl: 567,
      totalTrades: 3,
      profitMakingPct: 66.67,
      lossMakingPct: 33.33,
    })
    expect(res.body.data.noteText).toBe('All calculations are done assuming INR 50,000 capital deployed and 5X margin used in each trade.')
  })

  it('re-prices every trade when the sizing changes', async () => {
    const res = await api(boss).patch(`/communities/${intraday.id}/settings`, { capital: 100_000, margin: 2, chargesPerTrade: 100, note: '  My note  ' })
    expect(res.status).toBe(200)

    const overview = await api(boss).get(`/communities/${intraday.id}/overview`)
    expect(overview.body.data.summary.capitalDeployed).toBe(100_000)
    expect(overview.body.data.summary.totalCharges).toBe(300)
    expect(overview.body.data.noteText).toBe('My note')

    const list = await api(boss).get(`/communities/${intraday.id}/trades`)
    // 100000 x 2 / 368.2 = 543.2 shares x -2.5
    expect(list.body.data.items[0]).toMatchObject({ grossPnl: -1358, charges: 100, netPnl: -1458 })

    const cleared = await api(boss).patch(`/communities/${intraday.id}/settings`, { note: '' })
    expect(cleared.body.data.note).toBeNull()
  })

  it('S.N. counts over every trade, so a month view keeps its numbers', async () => {
    await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-11-02', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8 }))
    const res = await api(boss).get(`/communities/${intraday.id}/trades?month=2026-11`)
    expect(res.body.data.items.map((r: { serialNo: number }) => r.serialNo)).toEqual([4])
    expect(res.body.data.months).toEqual(['2026-11', '2026-10'])
  })

  it('pages in S.N. order, oldest first, with no way to reverse it', async () => {
    const first = await api(boss).get(`/communities/${intraday.id}/trades?pageSize=2&page=1&order=desc`)
    expect(first.body.data.items.map((r: { serialNo: number }) => r.serialNo)).toEqual([1, 2])
    const res = await api(boss).get(`/communities/${intraday.id}/trades?pageSize=2&page=2`)
    expect(res.body.data).toMatchObject({ total: 3, page: 2, pageSize: 2, totalPages: 2 })
    expect(res.body.data.items.map((r: { serialNo: number; name: string }) => [r.serialNo, r.name])).toEqual([[3, 'IEX']])
  })

  it('needs a side and an exit price', async () => {
    const res = await api(boss).post(`/communities/${intraday.id}/trades`, { tradeDate: '2026-10-09', name: 'LTM', entryPrice: 4120 })
    expect(res.status).toBe(422)
    expect(Object.keys(res.body.errors).sort()).toEqual(['exitPrice', 'side'])
  })

  describe('charges that differ from trade to trade', () => {
    const tradesOf = async () => (await api(boss).get(`/communities/${intraday.id}/trades`)).body.data.items as { name: string; charges: number; netPnl: number; grossPnl: number; ownCharges: number | null }[]

    it('uses the charges given on a trade, and the board default for one that has none', async () => {
      const res = await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-10-08', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: 87.5 }))
      expect(res.status).toBe(201)

      const [ambuja, , , astral] = await tradesOf()
      expect(ambuja).toMatchObject({ charges: 140, ownCharges: null, netPnl: -1837 })
      expect(astral).toMatchObject({ charges: 87.5, ownCharges: 87.5, netPnl: astral!.grossPnl - 87.5 })
    })

    it('adds the trades\' own charges into the totals, and a changed default only re-prices the trades without their own', async () => {
      await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-10-08', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: 60 }))
      const total = async () => (await api(boss).get(`/communities/${intraday.id}/overview`)).body.data.summary.totalCharges
      expect(await total()).toBe(3 * 140 + 60)

      await api(boss).patch(`/communities/${intraday.id}/settings`, { chargesPerTrade: 100 })
      expect(await total()).toBe(3 * 100 + 60)
    })

    it('treats zero as a real figure, not as "use the default"', async () => {
      await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-10-08', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: 0 }))
      expect((await tradesOf())[3]).toMatchObject({ charges: 0, ownCharges: 0 })
    })

    it('edits a trade\'s charges, and clearing them goes back to the default', async () => {
      const [ambuja] = (await api(boss).get(`/communities/${intraday.id}/trades`)).body.data.items
      const edit = (body: object) => api(boss).patch(`/communities/${intraday.id}/trades/${ambuja.id}`, body)

      expect((await edit({ charges: 95.25 })).status).toBe(200)
      expect((await tradesOf())[0]).toMatchObject({ charges: 95.25, ownCharges: 95.25, netPnl: -1697 - 95.25 })
      // Editing something else leaves them alone.
      await edit({ exitPrice: 365.6 })
      expect((await tradesOf())[0]).toMatchObject({ ownCharges: 95.25 })
      // null clears them.
      expect((await edit({ charges: null })).status).toBe(200)
      expect((await tradesOf())[0]).toMatchObject({ charges: 140, ownCharges: null })
    })

    it('refuses negative or non-numeric charges, and swing boards do not take them', async () => {
      const bad = await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-10-08', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: -5 }))
      expect(bad.status).toBe(422)
      expect(Object.keys(bad.body.errors)).toEqual(['charges'])
      const nan = await api(boss).post(`/communities/${intraday.id}/trades`, intradayRow({ tradeDate: '2026-10-08', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: 'abc' }))
      expect(nan.status).toBe(422)

      await link(swing.id, 'swing')
      await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ charges: 50 }))
      expect(await prisma.performanceTrade.count({ where: { charges: { not: null } } })).toBe(0)
    })

    it('reads a Charges column from a sheet, ignores a blank one, and updates a trade whose charges changed', async () => {
      const rows = [
        intradayRow({ tradeDate: '2026-10-09', name: 'Astral', side: 'sell', entryPrice: 1432, exitPrice: 1424.8, charges: '₹ 1,250.50' }),
        intradayRow({ tradeDate: '2026-10-10', name: 'SBIN', entryPrice: 800, exitPrice: 804, charges: '-72.00' }),
        intradayRow({ tradeDate: '2026-10-11', name: 'TCS', entryPrice: 4000, exitPrice: 4010, charges: '' }),
      ]
      const first = await api(boss).post(`/communities/${intraday.id}/import`, { rows })
      expect(first.body.data).toMatchObject({ created: 3, errors: [] })
      const byName = Object.fromEntries((await tradesOf()).map(t => [t.name, t]))
      expect(byName['Astral']).toMatchObject({ ownCharges: 1250.5 })
      expect(byName['SBIN']).toMatchObject({ ownCharges: 72 })
      expect(byName['TCS']).toMatchObject({ ownCharges: null, charges: 140 })

      // The same sheet again changes nothing; a new figure updates the trade; a blank cell leaves the stored one.
      expect((await api(boss).post(`/communities/${intraday.id}/import`, { rows })).body.data).toMatchObject({ created: 0, updated: 0, unchanged: 3 })
      const again = await api(boss).post(`/communities/${intraday.id}/import`, { rows: [{ ...rows[0], charges: 99 }, { ...rows[1], charges: '' }] })
      expect(again.body.data).toMatchObject({ updated: 1, unchanged: 1 })
      const after = Object.fromEntries((await tradesOf()).map(t => [t.name, t]))
      expect(after['Astral']).toMatchObject({ ownCharges: 99 })
      expect(after['SBIN']).toMatchObject({ ownCharges: 72 })
    })
  })

  it('does not take segments other than main, or settings that are not its own', async () => {
    expect((await api(boss).get(`/communities/${intraday.id}/trades?segment=long_term`)).status).toBe(400)
    await link(swing.id, 'swing')
    const res = await api(boss).patch(`/communities/${swing.id}/settings`, { capital: 10_000 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NOT_INTRADAY')
  })
})

describe('swing board', () => {
  beforeEach(async () => {
    await link(swing.id, 'swing')
  })

  it('computes target, return, status and holding days', async () => {
    await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ tradeDate: '2026-07-31', name: 'Hindustan Copper', symbol: 'hindcopper', entryPrice: 537, cmp: 399.85 }))
    await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ exitDate: '2026-08-14', analysis: '5% booked' }))

    const res = await api(boss).get(`/communities/${swing.id}/trades`)
    const [copper, bls] = res.body.data.items
    expect(copper).toMatchObject({ symbol: 'HINDCOPPER', targetPct: 5, targetPrice: 563.85, returnPct: -25.54, status: 'open', holdingDays: null, exitDate: null })
    expect(bls).toMatchObject({ targetPrice: 275.1, returnPct: -19.85, status: 'target_met', holdingDays: 2, exitDate: '2026-08-14', analysis: '5% booked' })

    const overview = await api(boss).get(`/communities/${swing.id}/overview`)
    expect(overview.body.data.summary).toMatchObject({ kind: 'swing', averageHoldingDays: 2, totalTrades: 2, periods: [] })
    expect(overview.body.data.noteText).toBeNull()
  })

  it('period cards count the trades given and met between two months', async () => {
    const rows = [
      swingRow({ tradeDate: '2026-01-05', symbol: 'A', name: 'A', exitDate: '2026-01-20' }),
      swingRow({ tradeDate: '2026-02-05', symbol: 'B', name: 'B' }),
      swingRow({ tradeDate: '2026-03-31', symbol: 'C', name: 'C', exitDate: '2026-04-10' }),
      swingRow({ tradeDate: '2026-04-01', symbol: 'D', name: 'D', exitDate: '2026-04-03' }), // outside Jan to Mar
    ]
    await api(boss).post(`/communities/${swing.id}/import`, { rows })

    const created = await api(boss).post(`/communities/${swing.id}/periods`, { name: 'Jan26 to Mar26', fromMonth: '2026-01', toMonth: '2026-03' })
    expect(created.status).toBe(201)

    const overview = await api(boss).get(`/communities/${swing.id}/overview`)
    expect(overview.body.data.summary.periods).toEqual([
      expect.objectContaining({ id: created.body.data.id, name: 'Jan26 to Mar26', label: 'Jan26 to Mar26', isDefault: true, fromMonth: '2026-01', toMonth: '2026-03', given: 3, met: 2, metPct: 66.67 }),
    ])

    // Editing the range moves the card.
    await api(boss).patch(`/communities/${swing.id}/periods/${created.body.data.id}`, { name: 'Jan26 to Apr26', toMonth: '2026-04' })
    const moved = await api(boss).get(`/communities/${swing.id}/overview`)
    expect(moved.body.data.summary.periods[0]).toMatchObject({ label: 'Jan26 to Apr26', given: 4, met: 3, metPct: 75 })

    expect((await api(boss).del(`/communities/${swing.id}/periods/${created.body.data.id}`)).status).toBe(200)
    expect((await api(boss).get(`/communities/${swing.id}/overview`)).body.data.summary.periods).toEqual([])
  })

  describe('period names and the default', () => {
    const add = (body: Record<string, unknown>) => api(boss).post(`/communities/${swing.id}/periods`, { fromMonth: '2026-01', toMonth: '2026-03', ...body })
    const cards = async () =>
      ((await api(boss).get(`/communities/${swing.id}/overview`)).body.data.summary.periods as { id: string; name: string; isDefault: boolean }[]).map(p => [p.name, p.isDefault])

    it('needs a name', async () => {
      const res = await add({})
      expect(res.status).toBe(422)
      expect(Object.keys(res.body.errors)).toEqual(['name'])
    })

    it('the first card is the default whatever was asked', async () => {
      await add({ name: 'First', isDefault: false })
      expect(await cards()).toEqual([['First', true]])
    })

    it('only one card is the default: choosing another moves it, and the default is listed first', async () => {
      await add({ name: 'First', fromMonth: '2026-01', toMonth: '2026-03' })
      await add({ name: 'Second', fromMonth: '2026-02', toMonth: '2026-04' })
      expect(await cards()).toEqual([['First', true], ['Second', false]])

      await add({ name: 'Third', fromMonth: '2026-03', toMonth: '2026-05', isDefault: true })
      expect(await cards()).toEqual([['Third', true], ['First', false], ['Second', false]])

      const second = (await api(boss).get(`/communities/${swing.id}/overview`)).body.data.summary.periods.find((p: { name: string }) => p.name === 'Second')
      await api(boss).patch(`/communities/${swing.id}/periods/${second.id}`, { isDefault: true }).expect(200)
      expect(await cards()).toEqual([['Second', true], ['First', false], ['Third', false]])
    })

    it('the default cannot be switched off, only handed to another card', async () => {
      const first = await add({ name: 'First' })
      const res = await api(boss).patch(`/communities/${swing.id}/periods/${first.body.data.id}`, { isDefault: false })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('DEFAULT_REQUIRED')
    })

    it('removing the default hands it to the oldest card left', async () => {
      const first = await add({ name: 'First', fromMonth: '2026-01', toMonth: '2026-03' })
      await add({ name: 'Second', fromMonth: '2026-02', toMonth: '2026-04' })
      await add({ name: 'Third', fromMonth: '2026-03', toMonth: '2026-05' })
      await api(boss).del(`/communities/${swing.id}/periods/${first.body.data.id}`).expect(200)
      expect(await cards()).toEqual([['Second', true], ['Third', false]])
    })
  })

  it('refuses a period that ends before it starts, and a period on an intraday board', async () => {
    expect((await api(boss).post(`/communities/${swing.id}/periods`, { name: 'Backwards', fromMonth: '2026-05', toMonth: '2026-02' })).body.code).toBe('INVALID_PERIOD')
    expect((await api(boss).post(`/communities/${swing.id}/periods`, { name: 'Bad month', fromMonth: '2026-5', toMonth: '2026-06' })).status).toBe(422)

    await link(intraday.id, 'intraday')
    expect((await api(boss).post(`/communities/${intraday.id}/periods`, { name: 'Q1', fromMonth: '2026-01', toMonth: '2026-03' })).body.code).toBe('NOT_SWING')
  })

  it('refuses a second trade for the same stock on the same day, and an exit before the trade', async () => {
    await api(boss).post(`/communities/${swing.id}/trades`, swingRow())
    const dup = await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ name: 'BLS again', symbol: 'bls' }))
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('TRADE_EXISTS')

    const early = await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ symbol: 'X', name: 'X', exitDate: '2026-08-01' }))
    expect(early.status).toBe(400)
    expect(early.body.code).toBe('INVALID_EXIT_DATE')
  })

  it('edits a trade: close it, change visibility, clear a field', async () => {
    const id = (await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ analysis: 'HOLD', targetPct: 8 }))).body.data.id as string

    await api(boss).patch(`/communities/${swing.id}/trades/${id}`, { exitDate: '2026-08-20', analysis: '8% booked', visibility: 'show' })
    let row = (await api(boss).get(`/communities/${swing.id}/trades`)).body.data.items[0]
    expect(row).toMatchObject({ status: 'target_met', holdingDays: 8, analysis: '8% booked', visibility: 'show', visibleToFree: true, targetPct: 8 })

    await api(boss).patch(`/communities/${swing.id}/trades/${id}`, { exitDate: null, targetPct: null, cmp: null })
    row = (await api(boss).get(`/communities/${swing.id}/trades`)).body.data.items[0]
    expect(row).toMatchObject({ status: 'open', exitDate: null, targetPct: 5, cmp: null, returnPct: null })

    expect((await api(boss).patch(`/communities/${swing.id}/trades/${id}`, { visibility: 'maybe' })).status).toBe(422)
    expect((await api(boss).patch(`/communities/${swing.id}/trades/${id}`, { exitDate: '2026-01-01' })).body.code).toBe('INVALID_EXIT_DATE')
  })

  it('moving a trade onto another trade\'s key is a conflict', async () => {
    await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ symbol: 'AAA', name: 'AAA' }))
    const id = (await api(boss).post(`/communities/${swing.id}/trades`, swingRow({ symbol: 'BBB', name: 'BBB' }))).body.data.id as string
    const res = await api(boss).patch(`/communities/${swing.id}/trades/${id}`, { symbol: 'AAA' })
    expect(res.status).toBe(409)
  })

  it('deletes a trade, once', async () => {
    const id = (await api(boss).post(`/communities/${swing.id}/trades`, swingRow())).body.data.id as string
    expect((await api(boss).del(`/communities/${swing.id}/trades/${id}`)).status).toBe(200)
    expect((await api(boss).del(`/communities/${swing.id}/trades/${id}`)).status).toBe(404)
    expect((await prisma.performanceTrade.count())).toBe(0)
  })

  it('rule bar settings are validated', async () => {
    expect((await api(boss).patch(`/communities/${swing.id}/settings`, { hideNewerThanDays: 14, maxFreeTrades: 5 })).body.data).toMatchObject({ hideNewerThanDays: 14, maxFreeTrades: 5 })
    expect((await api(boss).patch(`/communities/${swing.id}/settings`, { hideNewerThanDays: -1 })).status).toBe(422)
    expect((await api(boss).patch(`/communities/${swing.id}/settings`, { maxFreeTrades: 2.5 })).status).toBe(422)
    expect((await api(boss).patch(`/communities/${swing.id}/settings`, { maxFreeTrades: 51 })).status).toBe(422)
  })
})

describe('investor board segments', () => {
  beforeEach(async () => {
    await link(investor.id, 'investor')
  })

  it('keeps each segment\'s trades, numbers and summary apart', async () => {
    await api(boss).post(`/communities/${investor.id}/trades`, { ...swingRow({ symbol: 'SHRIRAM', name: 'Shriram Finance' }), segment: 'investor' })
    await api(boss).post(`/communities/${investor.id}/trades`, { ...swingRow({ symbol: 'SHRIRAM', name: 'Shriram Finance' }), segment: 'long_term' })
    await api(boss).post(`/communities/${investor.id}/trades`, { ...swingRow({ symbol: 'AAPL', name: 'Apple', exitDate: '2026-09-01' }), segment: 'us_investment' })

    for (const [segment, total] of [['investor', 1], ['long_term', 1], ['us_investment', 1]] as const) {
      const list = await api(boss).get(`/communities/${investor.id}/trades?segment=${segment}`)
      expect(list.body.data.total).toBe(total)
      expect(list.body.data.items[0].serialNo).toBe(1)
    }
    const us = await api(boss).get(`/communities/${investor.id}/overview?segment=us_investment`)
    expect(us.body.data.summary).toMatchObject({ kind: 'investor', totalTrades: 1, averageHoldingDays: 20 })
    // No segment given: the first one.
    expect((await api(boss).get(`/communities/${investor.id}/overview`)).body.data.segment).toBe('investor')
  })

  it('investor trades default to a 10% target', async () => {
    await api(boss).post(`/communities/${investor.id}/trades`, swingRow({ symbol: 'GNG', name: 'GNG Electronics', entryPrice: 614 }))
    const row = (await api(boss).get(`/communities/${investor.id}/trades`)).body.data.items[0]
    expect(row).toMatchObject({ targetPct: 10, targetPrice: 675.4 })
  })

  it('a segment that is not one of its own is a 400', async () => {
    const res = await api(boss).post(`/communities/${investor.id}/trades`, { ...swingRow(), segment: 'main' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_SEGMENT')
  })
})

describe('sheet import', () => {
  beforeEach(async () => {
    await link(swing.id, 'swing')
  })

  const sheet = () => [
    swingRow({ tradeDate: '2026-08-12', symbol: 'BLS', name: 'BLS International', cmp: 209.98 }),
    swingRow({ tradeDate: '2026-08-19', symbol: 'BALRAMCHIN', name: 'Balrampur Chini', entryPrice: 659, cmp: 589.45 }),
  ]

  it('creates new trades, then updates them on re-upload and keeps visibility', async () => {
    const first = await api(boss).post(`/communities/${swing.id}/import`, { rows: sheet() })
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ total: 2, created: 2, updated: 0, unchanged: 0, errors: [], dryRun: false })

    const bls = await prisma.performanceTrade.findFirstOrThrow({ where: { name: 'BLS International' } })
    await api(boss).patch(`/communities/${swing.id}/trades/${bls.id}`, { visibility: 'hide' })

    // The same sheet again with one trade closed.
    const second = await api(boss).post(`/communities/${swing.id}/import`, {
      rows: [{ ...sheet()[0], exitDate: '2026-08-14', analysis: '5% booked' }, sheet()[1]],
    })
    expect(second.body.data).toMatchObject({ created: 0, updated: 1, unchanged: 1 })

    const after = await prisma.performanceTrade.findUniqueOrThrow({ where: { id: bls.id } })
    expect(after.exitDate?.toISOString().slice(0, 10)).toBe('2026-08-14')
    expect(after.analysis).toBe('5% booked')
    expect(after.visibility).toBe('hide')
    expect(await prisma.performanceTrade.count()).toBe(2)
  })

  it('a blank cell leaves the stored value alone', async () => {
    await api(boss).post(`/communities/${swing.id}/import`, { rows: [swingRow({ analysis: 'HOLD', targetPct: 8, exitDate: '2026-08-14' })] })
    const res = await api(boss).post(`/communities/${swing.id}/import`, {
      rows: [swingRow({ cmp: 215, analysis: '', targetPct: '', exitDate: '' })],
    })
    expect(res.body.data).toMatchObject({ updated: 1 })
    const t = await prisma.performanceTrade.findFirstOrThrow()
    expect(Number(t.cmp)).toBe(215)
    expect(t.analysis).toBe('HOLD')
    expect(Number(t.targetPct)).toBe(8)
    expect(t.exitDate).not.toBeNull()
  })

  it('reports bad rows by sheet row and still imports the good ones', async () => {
    const res = await api(boss).post(`/communities/${swing.id}/import`, {
      rows: [
        swingRow({ symbol: 'GOOD', name: 'Good' }),
        swingRow({ symbol: 'NOPRICE', name: 'No Price', entryPrice: '' }),
        swingRow({ symbol: 'BADDATE', name: 'Bad Date', tradeDate: '2026-02-30' }),
        swingRow({ symbol: 'EARLY', name: 'Early Exit', exitDate: '2026-08-01' }),
        swingRow({ symbol: 'GOOD', name: 'Good again' }),
        { ...swingRow({ symbol: 'HINT', name: 'Hint', entryPrice: 'abc' }), row: 40 },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(1)
    expect(res.body.data.errors).toEqual([
      { row: 3, ref: 'NOPRICE', reason: 'Entry price is required' },
      { row: 4, ref: 'BADDATE', reason: 'Date is not a real date' },
      { row: 5, ref: 'EARLY', reason: 'Exit date cannot be before the trade date' },
      { row: 6, ref: 'GOOD', reason: 'Same trade as row 2 in this sheet' },
      { row: 40, ref: 'HINT', reason: 'Entry price must be a number' },
    ])
    expect(await prisma.performanceTrade.count()).toBe(1)
  })

  it('accepts sheet-style numbers and text', async () => {
    const res = await api(boss).post(`/communities/${swing.id}/import`, {
      rows: [{ tradeDate: '2026-08-12', name: '  BLS International ', symbol: 'bls', entryPrice: '₹ 1,262.50', cmp: '1,300', targetPct: '7.5%', analysis: ' HOLD ' }],
    })
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
    const t = await prisma.performanceTrade.findFirstOrThrow()
    expect(t).toMatchObject({ name: 'BLS International', symbol: 'BLS', analysis: 'HOLD' })
    expect(Number(t.entryPrice)).toBe(1262.5)
    expect(Number(t.targetPct)).toBe(7.5)
  })

  it('a dry run reports what would happen and writes nothing', async () => {
    await api(boss).post(`/communities/${swing.id}/import`, { rows: [sheet()[0]] })
    const res = await api(boss).post(`/communities/${swing.id}/import`, {
      dryRun: true,
      rows: [{ ...sheet()[0], exitDate: '2026-08-14' }, sheet()[1], swingRow({ symbol: 'BAD', name: 'Bad', entryPrice: -1 })],
    })
    expect(res.body.data).toMatchObject({ dryRun: true, total: 3, created: 1, updated: 1, unchanged: 0 })
    expect(res.body.data.errors).toHaveLength(1)
    expect(await prisma.performanceTrade.count()).toBe(1)
    expect((await prisma.performanceTrade.findFirstOrThrow()).exitDate).toBeNull()
  })

  it('intraday: the same stock can repeat in a day, but not with the same side and entry', async () => {
    await link(intraday.id, 'intraday')
    const res = await api(boss).post(`/communities/${intraday.id}/import`, {
      rows: [
        intradayRow(),
        intradayRow({ entryPrice: 370, exitPrice: 372 }),
        intradayRow({ name: ' ambuja   cement ' }), // same as the first once normalised
        intradayRow({ side: 'hold' }),
      ],
    })
    expect(res.body.data.created).toBe(2)
    expect(res.body.data.errors.map((e: { row: number }) => e.row)).toEqual([4, 5])
    expect(res.body.data.errors[1].reason).toBe('Type must be Buy or Sell')
  })

  it('rejects an empty sheet, an oversized one, and a segment that is not the board\'s', async () => {
    expect((await api(boss).post(`/communities/${swing.id}/import`, { rows: [] })).status).toBe(422)
    const many = Array.from({ length: 2001 }, (_, i) => swingRow({ symbol: `S${i}`, name: `S${i}` }))
    expect((await api(boss).post(`/communities/${swing.id}/import`, { rows: many })).status).toBe(422)
    expect((await api(boss).post(`/communities/${swing.id}/import`, { segment: 'long_term', rows: sheet() })).body.code).toBe('INVALID_SEGMENT')
  })

  it('takes a full-size sheet in one request (over the default 100 KB body limit)', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) =>
      swingRow({ tradeDate: daysFromNow(-1 - (i % 300)), symbol: `STOCK${i}`, name: `Stock number ${i}`, analysis: 'Can Avg at CMP', targetPct: 5 }),
    )
    const res = await api(boss).post(`/communities/${swing.id}/import`, { rows })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ total: 2000, created: 2000, errors: [] })
  })
})
