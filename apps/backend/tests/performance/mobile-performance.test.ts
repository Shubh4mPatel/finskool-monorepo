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

  it('filters by month without changing the summary', async () => {
    const all = (await get(paidMember, `/communities/${swing.id}?limit=50`)).body.data
    const month = (all.items[0].tradeDate as string).slice(0, 7)
    const res = await get(paidMember, `/communities/${swing.id}?limit=50&month=${month}`)
    const items = res.body.data.items as Item[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(14)
    expect(items.every(i => (i['tradeDate'] as string).startsWith(month))).toBe(true)
    expect(res.body.data.summary).toEqual(all.summary)
  })

  it('rejects a bad cursor, month, limit and segment', async () => {
    expect((await get(paidMember, `/communities/${swing.id}?cursor=garbage`)).body.code).toBe('INVALID_CURSOR')
    expect((await get(paidMember, `/communities/${swing.id}?month=2026-13`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?limit=0`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?limit=51`)).status).toBe(422)
    expect((await get(paidMember, `/communities/${swing.id}?segment=long_term`)).body.code).toBe('INVALID_SEGMENT')
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
