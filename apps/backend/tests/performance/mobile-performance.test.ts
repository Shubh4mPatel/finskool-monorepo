import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestMobileMember } from '../helpers/fixtures.js'

// The mobile Performance API: paid members see every trade, free members only the ones the admin allows, and
// the summary is the same for both. "Free" means no live subscription to that community, not an error.

const app = createApp()

let boss: { id: string; auth: string }
let freeCommunity: { id: string }
let swing: { id: string }
let swingBoardId: string

let freeMember: TestMobileMember
let paidMember: TestMobileMember

const get = (m: TestMobileMember, url: string) => request(app).get(`/api/v1/mobile/performance${url}`).set('Cookie', mobileCookie(m))

interface Item { id: string; name: string; [k: string]: unknown }

/** Seven trades on the swing board, newest first by age in days:
 *   1d auto (too new)   2d show   10d auto   15d hide   20d auto   30d auto   40d auto (over the quota of 3)
 *  With the default rules (hide newer than 7 days, at most 3), a free member sees 2d, 10d, 20d, 30d. */
const AGES: [number, 'auto' | 'show' | 'hide'][] = [[1, 'auto'], [2, 'show'], [10, 'auto'], [15, 'hide'], [20, 'auto'], [30, 'auto'], [40, 'auto']]
const FREE_SEES = ['T2', 'T10', 'T20', 'T30']

async function addTrade(boardId: string, over: Record<string, unknown> = {}) {
  const date = (over['tradeDate'] as string | undefined) ?? daysFromNow(-5)
  const symbol = (over['symbol'] as string | undefined) ?? 'SYM'
  return prisma.performanceTrade.create({
    data: {
      boardId,
      segment: 'main',
      name: symbol,
      symbol,
      entryPrice: 100,
      cmp: 110,
      tradeKey: `${date}|${symbol}`,
      ...over,
      tradeDate: new Date(date),
    } as never,
  })
}

async function seedSwingTrades() {
  for (const [age, visibility] of AGES) {
    await addTrade(swingBoardId, { tradeDate: daysFromNow(-age), symbol: `T${age}`, visibility })
  }
}

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  freeCommunity = await createCommunity(boss.id, { name: 'Free', isFree: true })
  swing = await createCommunity(boss.id, { name: 'Swing Alpha' })
  swingBoardId = (await prisma.performanceBoard.create({ data: { communityId: swing.id, kind: 'swing' } })).id

  freeMember = await createMobileMember({ subscriptions: [{ communityId: freeCommunity.id, validUntil: daysFromNow(36500) }] })
  paidMember = await createMobileMember({
    subscriptions: [
      { communityId: freeCommunity.id, validUntil: daysFromNow(36500) },
      { communityId: swing.id, validUntil: daysFromNow(30) },
    ],
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('free versus paid', () => {
  beforeEach(seedSwingTrades)

  it('a free member sees only what the rules and the admin allow, newest first', async () => {
    const res = await get(freeMember, `/communities/${swing.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ communityId: swing.id, communityName: 'Swing Alpha', kind: 'swing', access: 'free', segment: 'main', hiddenCount: 3, nextCursor: null })
    expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(FREE_SEES)
  })

  it('a paid member sees every trade and no hidden count', async () => {
    const res = await get(paidMember, `/communities/${swing.id}`)
    expect(res.body.data.access).toBe('paid')
    expect(res.body.data.hiddenCount).toBeNull()
    expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(['T1', 'T2', 'T10', 'T15', 'T20', 'T30', 'T40'])
  })

  it('the summary covers every trade for both', async () => {
    await prisma.performanceTrade.updateMany({ where: { name: { in: ['T2', 'T30'] } }, data: { exitDate: new Date(daysFromNow(-1)) } })
    const [free, paid] = await Promise.all([get(freeMember, `/communities/${swing.id}`), get(paidMember, `/communities/${swing.id}`)])
    expect(free.body.data.summary).toEqual(paid.body.data.summary)
    expect(paid.body.data.summary).toMatchObject({ kind: 'swing', totalTrades: 7 })
    expect(paid.body.data.summary.averageHoldingDays).not.toBeNull()
  })

  it('rows carry the numbers but no admin controls and no serial number', async () => {
    const res = await get(paidMember, `/communities/${swing.id}`)
    const item = (res.body.data.items as Item[])[0]!
    expect(item).toMatchObject({ name: 'T1', symbol: 'T1', entryPrice: 100, cmp: 110, returnPct: 10, targetPct: 5, targetPrice: 105, status: 'open', holdingDays: null })
    expect(item).not.toHaveProperty('visibility')
    expect(item).not.toHaveProperty('visibleToFree')
    expect(item).not.toHaveProperty('serialNo')
  })

  it('a lapsed or switched-off subscription is free, even though the row is still marked active', async () => {
    const lapsed = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-3) }] })
    const inactive = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30), isActive: false }] })
    for (const m of [lapsed, inactive]) {
      const res = await get(m, `/communities/${swing.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.access).toBe('free')
      expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(FREE_SEES)
    }
  })

  it('a paid subscription to another community does not unlock this one', async () => {
    const other = await createCommunity(boss.id, { name: 'Other' })
    const m = await createMobileMember({ subscriptions: [{ communityId: other.id, validUntil: daysFromNow(30) }] })
    expect((await get(m, `/communities/${swing.id}`)).body.data.access).toBe('free')
  })

  it('an admin who manages the community counts as paid, one who does not as free', async () => {
    const manager = await createMobileMember()
    await prisma.user.update({ where: { id: manager.id }, data: { role: 'admin', isSuperAdmin: false } })
    await prisma.communityAdmin.create({ data: { adminId: manager.id, communityId: swing.id } })
    // The mobile session caches an admin's accessible communities at login, as the other mobile modules rely on.
    await prisma.mobileSession.updateMany({ where: { userId: manager.id }, data: { accessibleCommunityIds: [swing.id] } })
    const stranger = await createMobileMember()
    await prisma.user.update({ where: { id: stranger.id }, data: { role: 'admin', isSuperAdmin: false } })

    expect((await get(manager, `/communities/${swing.id}`)).body.data).toMatchObject({ access: 'paid', hiddenCount: null })
    expect((await get(stranger, `/communities/${swing.id}`)).body.data).toMatchObject({ access: 'free', hiddenCount: 3 })
  })
})

describe('hit-rate cards (the period cards the admin sets up)', () => {
  // Two cards, as on the Swing Alpha dashboard: Oct25 to Aug26 and Jan26 to Aug26. Trades: 2 in Oct25, 1 in Jan26,
  // 1 in Aug26, and 1 in Sep26 (outside both cards); the Oct25, Jan26 and Aug26 ones have an exit date (target met).
  async function seedCards() {
    const add = (symbol: string, date: string, exitDate: string | null) =>
      prisma.performanceTrade.create({
        data: { boardId: swingBoardId, segment: 'main', name: symbol, symbol, entryPrice: 100, cmp: 110, tradeKey: `${date}|${symbol}`, tradeDate: new Date(date), exitDate: exitDate ? new Date(exitDate) : null } as never,
      })
    await add('A1', '2025-10-07', '2025-10-20')
    await add('A2', '2025-10-15', null)
    await add('B1', '2026-01-12', '2026-02-02')
    await add('C1', '2026-08-04', '2026-08-30')
    await add('D1', '2026-09-16', '2026-10-19')
    await prisma.performancePeriod.create({ data: { boardId: swingBoardId, segment: 'main', fromMonth: new Date('2025-10-01'), toMonth: new Date('2026-08-01') } })
    await prisma.performancePeriod.create({ data: { boardId: swingBoardId, segment: 'main', fromMonth: new Date('2026-01-01'), toMonth: new Date('2026-08-01') } })
  }

  it('the app gets both cards, with given, met and met %, in the order the admin made them', async () => {
    await seedCards()
    const res = await get(paidMember, `/communities/${swing.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.summary.periods).toMatchObject([
      { label: 'Oct25 to Aug26', fromMonth: '2025-10', toMonth: '2026-08', given: 4, met: 3, metPct: 75 },
      { label: 'Jan26 to Aug26', fromMonth: '2026-01', toMonth: '2026-08', given: 2, met: 2, metPct: 100 },
    ])
  })

  it('a free member gets the same two cards, counted over every trade, hidden ones included', async () => {
    await seedCards()
    const [free, paid] = await Promise.all([get(freeMember, `/communities/${swing.id}`), get(paidMember, `/communities/${swing.id}`)])
    expect(free.body.data.summary.periods).toHaveLength(2)
    expect(free.body.data.summary.periods).toEqual(paid.body.data.summary.periods)
    expect(free.body.data.hiddenCount).toBeGreaterThan(0)
  })

  it('the cards do not change with the month filter, and a new card shows at once', async () => {
    await seedCards()
    const filtered = await get(paidMember, `/communities/${swing.id}?month=2026-09`)
    expect(filtered.body.data.summary.periods).toHaveLength(2)
    expect((filtered.body.data.items as Item[]).map(i => i.name)).toEqual(['D1'])
    await prisma.performancePeriod.create({ data: { boardId: swingBoardId, segment: 'main', fromMonth: new Date('2025-10-01'), toMonth: new Date('2026-10-01') } })
    const more = await get(paidMember, `/communities/${swing.id}`)
    expect(more.body.data.summary.periods.map((p: { label: string }) => p.label)).toEqual(['Oct25 to Aug26', 'Jan26 to Aug26', 'Oct25 to Oct26'])
    expect(more.body.data.summary.periods[2]).toMatchObject({ given: 5, met: 4, metPct: 80 })
  })

  it('a board with no cards sends an empty list, never a missing field', async () => {
    const res = await get(paidMember, `/communities/${swing.id}`)
    expect(res.body.data.summary.periods).toEqual([])
  })
})

describe('the rule bar', () => {
  beforeEach(seedSwingTrades)

  const setRules = (rules: { hideNewerThanDays?: number; maxFreeTrades?: number }) =>
    prisma.performanceBoard.update({ where: { id: swingBoardId }, data: rules })

  it('follows the board\'s days and quota', async () => {
    await setRules({ hideNewerThanDays: 25, maxFreeTrades: 1 })
    // Auto trades 25+ days old: 30d and 40d; the quota of 1 keeps the newer. The shown 2d is always there.
    const res = await get(freeMember, `/communities/${swing.id}`)
    expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(['T2', 'T30'])
    expect(res.body.data.hiddenCount).toBe(5)
  })

  it('a quota of zero leaves only the trades shown by name', async () => {
    await setRules({ maxFreeTrades: 0 })
    const res = await get(freeMember, `/communities/${swing.id}`)
    expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(['T2'])
  })

  it('Show and Hide change what a free member sees, straight away', async () => {
    await prisma.performanceTrade.updateMany({ where: { name: 'T1' }, data: { visibility: 'show' } })
    await prisma.performanceTrade.updateMany({ where: { name: 'T10' }, data: { visibility: 'hide' } })
    const res = await get(freeMember, `/communities/${swing.id}`)
    // T10 is hidden, so the quota of 3 now reaches T40.
    expect((res.body.data.items as Item[]).map(i => i.name)).toEqual(['T1', 'T2', 'T20', 'T30', 'T40'])
  })

  it('the rules apply to each investor segment separately', async () => {
    const investor = await createCommunity(boss.id, { name: 'Investor Community' })
    const board = await prisma.performanceBoard.create({ data: { communityId: investor.id, kind: 'investor', maxFreeTrades: 1 } })
    for (const segment of ['investor', 'long_term'] as const) {
      for (const age of [20, 30]) {
        await addTrade(board.id, { segment, tradeDate: daysFromNow(-age), symbol: `${segment}-${age}`, tradeKey: `${segment}-${age}` })
      }
    }
    for (const [segment, newest] of [['investor', 'investor-20'], ['long_term', 'long_term-20']] as const) {
      const res = await get(freeMember, `/communities/${investor.id}?segment=${segment}`)
      expect((res.body.data.items as Item[]).map(i => i.name)).toEqual([newest])
      expect(res.body.data).toMatchObject({ segment, hiddenCount: 1, segments: ['investor', 'long_term', 'us_investment'] })
    }
    // No segment given: the first one.
    expect((await get(freeMember, `/communities/${investor.id}`)).body.data.segment).toBe('investor')
    expect((await get(freeMember, `/communities/${investor.id}?segment=main`)).body.code).toBe('INVALID_SEGMENT')
  })
})

describe('paging and filtering', () => {
  beforeEach(async () => {
    // Twelve trades over three months, plus two on the same day to exercise the id tie-break.
    for (let i = 0; i < 12; i++) await addTrade(swingBoardId, { tradeDate: daysFromNow(-(10 + i * 7)), symbol: `P${i}` })
    await addTrade(swingBoardId, { tradeDate: daysFromNow(-200), symbol: 'SAME1' })
    await addTrade(swingBoardId, { tradeDate: daysFromNow(-200), symbol: 'SAME2' })
  })

  async function walk(m: TestMobileMember, limit: number): Promise<string[][]> {
    const pages: string[][] = []
    let cursor: string | null = null
    do {
      const url: string = `/communities/${swing.id}?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`
      const res = await get(m, url)
      expect(res.status).toBe(200)
      pages.push((res.body.data.items as Item[]).map(i => i.id))
      cursor = res.body.data.nextCursor as string | null
    } while (cursor)
    return pages
  }

  it('walks every trade exactly once, newest first, for a paid member', async () => {
    const pages = await walk(paidMember, 5)
    expect(pages.map(p => p.length)).toEqual([5, 5, 4])
    const ids = pages.flat()
    expect(new Set(ids).size).toBe(14)

    const all = (await get(paidMember, `/communities/${swing.id}?limit=50`)).body.data.items as Item[]
    expect(ids).toEqual(all.map(i => i.id))
    const dates = all.map(i => i['tradeDate'] as string)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('a free member pages through only what they can see', async () => {
    const pages = await walk(freeMember, 2)
    // Default rules: the three newest eligible trades (all are older than 7 days).
    expect(pages.flat()).toHaveLength(3)
    expect(pages.map(p => p.length)).toEqual([2, 1])
  })

  it('filters by month, and the summary follows the same month', async () => {
    const all = (await get(paidMember, `/communities/${swing.id}?limit=50`)).body.data
    expect(all.summary.totalTrades).toBe(14)
    const month = (all.items[0].tradeDate as string).slice(0, 7)
    const res = await get(paidMember, `/communities/${swing.id}?limit=50&month=${month}`)
    const items = res.body.data.items as Item[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(14)
    expect(items.every(i => (i['tradeDate'] as string).startsWith(month))).toBe(true)
    expect(res.body.data.summary.totalTrades).toBe(items.length)
    expect(res.body.data.filter).toEqual({ fromMonth: month, toMonth: month })
  })

  it('rejects a bad cursor, month, limit and segment', async () => {
    expect((await get(paidMember, `/communities/${swing.id}?cursor=garbage`)).body.code).toBe('INVALID_CURSOR')
    expect((await get(paidMember, `/communities/${swing.id}?month=2026-13`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?limit=0`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?limit=51`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?segment=long_term`)).body.code).toBe('INVALID_SEGMENT')
  })
})

// Trades on fixed past dates, so a month means the same thing whenever the suite runs:
//   Jul25  J1 open
//   Aug25  A1 closed after 2 days, A2 open
//   Sep25  S1 closed after 10 days, S2 open, S3 open
//   Oct25  O1 closed after 1 day
describe('month filters on a swing board', () => {
  const T: [string, string, string | null][] = [
    ['J1', '2025-07-10', null],
    ['A1', '2025-08-04', '2025-08-06'],
    ['A2', '2025-08-20', null],
    ['S1', '2025-09-02', '2025-09-12'],
    ['S2', '2025-09-15', null],
    ['S3', '2025-09-29', null],
    ['O1', '2025-10-07', '2025-10-08'],
  ]
  const names = (res: { body: { data: { items: Item[] } } }) => res.body.data.items.map(i => i.name)

  beforeEach(async () => {
    await prisma.performanceBoard.update({ where: { id: swingBoardId }, data: { hideNewerThanDays: 0, maxFreeTrades: 50 } })
    for (const [symbol, tradeDate, exit] of T) {
      await addTrade(swingBoardId, { tradeDate, symbol, ...(exit ? { exitDate: new Date(exit) } : {}) })
    }
  })

  it('a run of months narrows the summary, the hit-rate card and the trades together', async () => {
    const res = await get(paidMember, `/communities/${swing.id}?fromMonth=2025-08&toMonth=2025-09`)
    expect(res.status).toBe(200)
    expect(names(res)).toEqual(['S3', 'S2', 'S1', 'A2', 'A1'])
    expect(res.body.data.filter).toEqual({ fromMonth: '2025-08', toMonth: '2025-09' })
    expect(res.body.data.summary).toMatchObject({
      kind: 'swing',
      totalTrades: 5,
      averageHoldingDays: 6,
      range: { fromMonth: '2025-08', toMonth: '2025-09', label: 'Aug25 to Sep25', given: 5, met: 2, metPct: 40 },
    })
  })

  it('without a filter the summary covers every trade and there is no range card', async () => {
    const res = await get(paidMember, `/communities/${swing.id}`)
    expect(res.body.data.filter).toBeNull()
    expect(names(res)).toEqual(['O1', 'S3', 'S2', 'S1', 'A2', 'A1', 'J1'])
    expect(res.body.data.summary).toMatchObject({ totalTrades: 7, averageHoldingDays: 4.3, range: null })
  })

  it('one month is a run of one', async () => {
    const res = await get(paidMember, `/communities/${swing.id}?month=2025-09`)
    expect(names(res)).toEqual(['S3', 'S2', 'S1'])
    expect(res.body.data.filter).toEqual({ fromMonth: '2025-09', toMonth: '2025-09' })
    expect(res.body.data.summary).toMatchObject({
      totalTrades: 3,
      averageHoldingDays: 10,
      range: { label: 'Sep25', given: 3, met: 1, metPct: 33.33 },
    })
  })

  it('the admin\'s fixed period cards do not change with the filter', async () => {
    await prisma.performancePeriod.create({
      data: { boardId: swingBoardId, segment: 'main', fromMonth: new Date('2025-07-01'), toMonth: new Date('2025-10-01') },
    })
    const card = { label: 'Jul25 to Oct25', given: 7, met: 3, metPct: 42.86 }
    const all = await get(paidMember, `/communities/${swing.id}`)
    const filtered = await get(paidMember, `/communities/${swing.id}?fromMonth=2025-08&toMonth=2025-09`)
    expect(all.body.data.summary.periods).toEqual([expect.objectContaining(card)])
    expect(filtered.body.data.summary.periods).toEqual([expect.objectContaining(card)])
  })

  it('months with no trades give an empty, zeroed answer', async () => {
    const res = await get(paidMember, `/communities/${swing.id}?fromMonth=2024-01&toMonth=2024-02`)
    expect(res.status).toBe(200)
    expect(res.body.data.items).toEqual([])
    expect(res.body.data.nextCursor).toBeNull()
    expect(res.body.data.summary).toMatchObject({ totalTrades: 0, averageHoldingDays: null, range: { given: 0, met: 0, metPct: 0 } })
  })

  it('pages through a run of months without leaving it', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const url: string = `/communities/${swing.id}?fromMonth=2025-08&toMonth=2025-09&limit=2${cursor ? `&cursor=${cursor}` : ''}`
      const res = await get(paidMember, url)
      seen.push(...names(res))
      cursor = res.body.data.nextCursor as string | null
    } while (cursor)
    expect(seen).toEqual(['S3', 'S2', 'S1', 'A2', 'A1'])
  })

  it('a run of months can span a year end, both ends included', async () => {
    await addTrade(swingBoardId, { tradeDate: '2025-12-10', symbol: 'D1' })
    await addTrade(swingBoardId, { tradeDate: '2026-01-05', symbol: 'N1' })
    await addTrade(swingBoardId, { tradeDate: '2026-03-02', symbol: 'M1' })
    const res = await get(paidMember, `/communities/${swing.id}?fromMonth=2025-10&toMonth=2026-02`)
    expect(names(res)).toEqual(['N1', 'D1', 'O1'])
    expect(res.body.data.summary).toMatchObject({ totalTrades: 3, range: { given: 3, met: 1 } })
  })

  it('lists the months that have trades, newest first, whatever the filter', async () => {
    const months = ['2025-10', '2025-09', '2025-08', '2025-07']
    expect((await get(paidMember, `/communities/${swing.id}`)).body.data.months).toEqual(months)
    expect((await get(paidMember, `/communities/${swing.id}?month=2025-08`)).body.data.months).toEqual(months)
  })

  describe('for a free member', () => {
    beforeEach(async () => {
      // Hold back J1 (outside the Aug-Sep run) and A2 and S3 (inside it).
      await prisma.performanceTrade.updateMany({ where: { name: { in: ['J1', 'A2', 'S3'] } }, data: { visibility: 'hide' } })
    })

    it('sees the same summary as a paid member, over the same months', async () => {
      const q = '?fromMonth=2025-08&toMonth=2025-09'
      const [free, paid] = await Promise.all([get(freeMember, `/communities/${swing.id}${q}`), get(paidMember, `/communities/${swing.id}${q}`)])
      expect(free.body.data.summary).toEqual(paid.body.data.summary)
      expect(free.body.data.summary.totalTrades).toBe(5)
    })

    it('gets only the allowed trades of the months, and a hidden count for those months only', async () => {
      const all = await get(freeMember, `/communities/${swing.id}`)
      expect(names(all)).toEqual(['O1', 'S2', 'S1', 'A1'])
      expect(all.body.data.hiddenCount).toBe(3)
      // July's only trade is held back from this member, but the month is still offered: the summary counts it.
      expect(all.body.data.months).toContain('2025-07')

      const run = await get(freeMember, `/communities/${swing.id}?fromMonth=2025-08&toMonth=2025-09`)
      expect(names(run)).toEqual(['S2', 'S1', 'A1'])
      expect(run.body.data.hiddenCount).toBe(2)

      const jul = await get(freeMember, `/communities/${swing.id}?month=2025-07`)
      expect(names(jul)).toEqual([])
      expect(jul.body.data.hiddenCount).toBe(1)
    })

    it('the free quota still counts over the whole board, not per month', async () => {
      await prisma.performanceBoard.update({ where: { id: swingBoardId }, data: { maxFreeTrades: 2 } })
      // Of the four allowed trades the two newest are shown: O1 and S2. Asking for August shows nothing.
      expect(names(await get(freeMember, `/communities/${swing.id}`))).toEqual(['O1', 'S2'])
      const aug = await get(freeMember, `/communities/${swing.id}?month=2025-08`)
      expect(names(aug)).toEqual([])
      expect(aug.body.data.hiddenCount).toBe(2)
    })
  })

  it('rejects a filter that does not make sense', async () => {
    const bad = async (qs: string) => {
      const res = await get(paidMember, `/communities/${swing.id}?${qs}`)
      expect(res.status).toBe(422)
      return res.body.errors as Record<string, string[]>
    }
    expect(await bad('month=2025-08&fromMonth=2025-08&toMonth=2025-09')).toHaveProperty('month')
    expect(await bad('month=2025-08&toMonth=2025-09')).toHaveProperty('month')
    expect(await bad('fromMonth=2025-08')).toHaveProperty('toMonth')
    expect(await bad('toMonth=2025-09')).toHaveProperty('fromMonth')
    expect(await bad('fromMonth=2025-09&toMonth=2025-08')).toHaveProperty('toMonth')
    expect(await bad('fromMonth=2025-8&toMonth=2025-09')).toHaveProperty('fromMonth')
    expect(await bad('fromMonth=2025-08&toMonth=2025-13')).toHaveProperty('toMonth')
  })
})

describe('month filter on an intraday board', () => {
  // Capital 50,000 at 5x with 140 of charges a trade, so a share bought at 100 is 2,500 shares.
  //   Aug25  Alpha buy 100 -> 102 = +5,000   Bravo sell 200 -> 190 = +12,500
  //   Sep25  Charlie buy 100 -> 98 = -5,000
  let intraday: { id: string }

  beforeEach(async () => {
    intraday = await createCommunity(boss.id, { name: 'Intraday Edge' })
    const board = await prisma.performanceBoard.create({ data: { communityId: intraday.id, kind: 'intraday', hideNewerThanDays: 0, maxFreeTrades: 50 } })
    const trade = (name: string, tradeDate: string, side: 'buy' | 'sell', entryPrice: number, exitPrice: number) =>
      addTrade(board.id, { tradeDate, symbol: undefined, name, side, entryPrice, exitPrice, cmp: null, tradeKey: name })
    await trade('Alpha', '2025-08-05', 'buy', 100, 102)
    await trade('Bravo', '2025-08-12', 'sell', 200, 190)
    await trade('Charlie', '2025-09-03', 'buy', 100, 98)
  })

  it('the summary cards and the trades both follow the month', async () => {
    const aug = await get(paidMember, `/communities/${intraday.id}?month=2025-08`)
    expect((aug.body.data.items as Item[]).map(i => i.name)).toEqual(['Bravo', 'Alpha'])
    expect(aug.body.data.summary).toEqual({
      kind: 'intraday',
      capitalDeployed: 50_000,
      grossPnl: 17_500,
      totalCharges: 280,
      overallPnl: 17_220,
      totalTrades: 2,
      profitMakingTrades: 2,
      lossMakingTrades: 0,
      profitMakingPct: 100,
      lossMakingPct: 0,
    })

    const sep = await get(paidMember, `/communities/${intraday.id}?month=2025-09`)
    expect((sep.body.data.items as Item[]).map(i => i.name)).toEqual(['Charlie'])
    expect(sep.body.data.summary).toMatchObject({ totalTrades: 1, grossPnl: -5000, overallPnl: -5140, lossMakingTrades: 1, lossMakingPct: 100 })
  })

  it('all months: the summary covers every trade, and the banner is unchanged', async () => {
    const res = await get(paidMember, `/communities/${intraday.id}`)
    expect(res.body.data.filter).toBeNull()
    expect(res.body.data.summary).toMatchObject({ totalTrades: 3, grossPnl: 12_500, totalCharges: 420, overallPnl: 12_080, profitMakingPct: 66.67, lossMakingPct: 33.33 })
    const aug = await get(paidMember, `/communities/${intraday.id}?month=2025-08`)
    expect(aug.body.data.noteText).toBe(res.body.data.noteText)
  })

  it('a run of months works here too, and a free member gets the same figures', async () => {
    const q = '?fromMonth=2025-08&toMonth=2025-09'
    const [free, paid] = await Promise.all([get(freeMember, `/communities/${intraday.id}${q}`), get(paidMember, `/communities/${intraday.id}${q}`)])
    expect(paid.body.data.summary).toMatchObject({ totalTrades: 3, overallPnl: 12_080 })
    expect(free.body.data.summary).toEqual(paid.body.data.summary)
    expect(free.body.data.access).toBe('free')
  })
})

describe('intraday board', () => {
  it('rows and summary use the board\'s sizing, and the banner comes along', async () => {
    const intraday = await createCommunity(boss.id, { name: 'Intraday Edge' })
    const board = await prisma.performanceBoard.create({ data: { communityId: intraday.id, kind: 'intraday', hideNewerThanDays: 0, maxFreeTrades: 5 } })
    await addTrade(board.id, { tradeDate: daysFromNow(-3), symbol: undefined, name: 'Ambuja Cement', side: 'buy', entryPrice: 368.2, exitPrice: 365.7, cmp: null, tradeKey: 'a' })

    const res = await get(freeMember, `/communities/${intraday.id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.items[0]).toMatchObject({ name: 'Ambuja Cement', side: 'buy', plPerShare: -2.5, plPct: -3.39, grossPnl: -1697, netPnl: -1837 })
    expect(res.body.data.summary).toMatchObject({ kind: 'intraday', capitalDeployed: 50_000, totalTrades: 1, overallPnl: -1837 })
    expect(res.body.data.noteText).toBe('All calculations are done assuming INR 50,000 capital deployed and 5X margin used in each trade.')
  })
})

describe('boards list', () => {
  it('tells the app which communities have a Performance screen and the caller\'s access to each', async () => {
    const intraday = await createCommunity(boss.id, { name: 'Intraday Edge' })
    await prisma.performanceBoard.create({ data: { communityId: intraday.id, kind: 'intraday' } })
    await createCommunity(boss.id, { name: 'No board here' })

    const free = await get(freeMember, '/boards')
    expect(free.status).toBe(200)
    expect(free.body.data.boards).toEqual([
      { communityId: swing.id, name: 'Swing Alpha', slug: expect.any(String), kind: 'swing', segments: ['main'], access: 'free' },
      { communityId: intraday.id, name: 'Intraday Edge', slug: expect.any(String), kind: 'intraday', segments: ['main'], access: 'free' },
    ])

    const paid = await get(paidMember, '/boards')
    expect((paid.body.data.boards as { name: string; access: string }[]).map(b => [b.name, b.access])).toEqual([
      ['Swing Alpha', 'paid'],
      ['Intraday Edge', 'free'],
    ])
  })

  it('a deleted community drops off the list and 404s', async () => {
    await prisma.community.update({ where: { id: swing.id }, data: { deletedAt: new Date() } })
    expect((await get(paidMember, '/boards')).body.data.boards).toEqual([])
    expect((await get(paidMember, `/communities/${swing.id}`)).status).toBe(404)
  })
})

describe('who can call it', () => {
  it('a community without a board is a 404, a junk id a 400', async () => {
    const bare = await createCommunity(boss.id, { name: 'Bare' })
    const res = await get(paidMember, `/communities/${bare.id}`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('PERFORMANCE_BOARD_NOT_FOUND')
    expect((await get(paidMember, '/communities/nope')).status).toBe(400)
  })

  it('needs a signed-in mobile session', async () => {
    expect((await request(app).get('/api/v1/mobile/performance/boards')).status).toBe(401)
    const web = await request(app).get('/api/v1/mobile/performance/boards').set('Authorization', boss.auth)
    expect(web.status).toBe(403)
    expect(web.body.code).toBe('MOBILE_ONLY')
  })
})
