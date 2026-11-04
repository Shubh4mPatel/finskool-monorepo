import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestMobileMember } from '../helpers/fixtures.js'

// A trade shows the stock's logo from the stocks table when the stock is there and has one; otherwise `logoUrl` is
// null and the screen draws initials. Swing and investor trades match on the NSE code, intraday trades (which have
// only a name) on the name read as a code or as the stock's name.

const app = createApp()

let boss: { id: string; auth: string }
let member: TestMobileMember
const boards: Record<'swing' | 'intraday', { communityId: string; boardId: string }> = {} as never

const LOGO = (code: string) => `https://community.example.test/assets/stock-logos/${code}.png`

const adminTrades = (kind: 'swing' | 'intraday') =>
  request(app).get(`/api/v1/admin/performance/communities/${boards[kind].communityId}/trades?pageSize=50`).set('Authorization', boss.auth)

const mobileTrades = (kind: 'swing' | 'intraday') =>
  request(app).get(`/api/v1/mobile/performance/communities/${boards[kind].communityId}`).set('Cookie', mobileCookie(member))

const logoByName = (items: { name: string; logoUrl: string | null }[]) => Object.fromEntries(items.map(i => [i.name, i.logoUrl]))

async function swingTrade(name: string, symbol: string, age: number) {
  const date = daysFromNow(-age)
  await prisma.performanceTrade.create({
    data: {
      boardId: boards.swing.boardId,
      segment: 'main',
      tradeDate: new Date(date),
      name,
      symbol,
      entryPrice: 100,
      cmp: 110,
      tradeKey: `${date}|${symbol}`,
    } as never,
  })
}

async function intradayTrade(name: string, age: number) {
  const date = daysFromNow(-age)
  await prisma.performanceTrade.create({
    data: {
      boardId: boards.intraday.boardId,
      segment: 'main',
      tradeDate: new Date(date),
      name,
      side: 'buy',
      entryPrice: 100,
      exitPrice: 105,
      tradeKey: `${date}|${name}|buy`,
    } as never,
  })
}

const stock = (symbol: string, name: string, logoUrl: string | null) => prisma.stock.create({ data: { symbol, name, logoUrl } })

beforeEach(async () => {
  await resetDb()
  await prisma.stock.deleteMany()
  boss = await createAdmin({ isSuperAdmin: true })
  for (const kind of ['swing', 'intraday'] as const) {
    const community = await createCommunity(boss.id, { name: `${kind} community` })
    const board = await prisma.performanceBoard.create({ data: { communityId: community.id, kind } })
    boards[kind] = { communityId: community.id, boardId: board.id }
  }
  member = await createMobileMember({
    subscriptions: [
      { communityId: boards.swing.communityId, validUntil: daysFromNow(30) },
      { communityId: boards.intraday.communityId, validUntil: daysFromNow(30) },
    ],
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('swing and investor trades', () => {
  beforeEach(async () => {
    await stock('KOTAKBANK', 'Kotak Mahindra Bank Ltd', LOGO('KOTAKBANK'))
    await stock('NOLOGO', 'No Logo Ltd', null)
    await swingTrade('Kotak Bank', 'KOTAKBANK', 3)
    await swingTrade('Lowercase Typed', 'kotakbank', 4)
    await swingTrade('Padded', ' KOTAKBANK ', 5)
    await swingTrade('Stock Without Logo', 'NOLOGO', 6)
    await swingTrade('Not In Table', 'GHOSTCO', 7)
  })

  it('the admin list carries the logo, matching the code whatever its case or spacing', async () => {
    const res = await adminTrades('swing')
    expect(res.status).toBe(200)
    expect(logoByName(res.body.data.items)).toEqual({
      'Kotak Bank': LOGO('KOTAKBANK'),
      'Lowercase Typed': LOGO('KOTAKBANK'),
      Padded: LOGO('KOTAKBANK'),
      'Stock Without Logo': null,
      'Not In Table': null,
    })
  })

  it('the app gets the same logos, and null where there is nothing to show', async () => {
    const res = await mobileTrades('swing')
    expect(res.status).toBe(200)
    expect(logoByName(res.body.data.items)).toEqual({
      'Kotak Bank': LOGO('KOTAKBANK'),
      'Lowercase Typed': LOGO('KOTAKBANK'),
      Padded: LOGO('KOTAKBANK'),
      'Stock Without Logo': null,
      'Not In Table': null,
    })
  })

  it('a stock whose logo arrives later shows it on the next load', async () => {
    await prisma.stock.update({ where: { symbol: 'NOLOGO' }, data: { logoUrl: LOGO('NOLOGO') } })
    const res = await adminTrades('swing')
    expect(logoByName(res.body.data.items)['Stock Without Logo']).toBe(LOGO('NOLOGO'))
  })
})

describe('intraday trades', () => {
  beforeEach(async () => {
    await stock('TATASTEEL', 'Tata Steel Ltd', LOGO('TATASTEEL'))
    await stock('AMBUJACEM', 'Ambuja Cements Ltd', LOGO('AMBUJACEM'))
    await intradayTrade('TATASTEEL', 3)
    await intradayTrade('Ambuja Cements Ltd', 4)
    await intradayTrade('ambuja cements ltd', 5)
    await intradayTrade('Something Else', 6)
  })

  it('reads the name as a code first, then as the stock name, ignoring case', async () => {
    const res = await adminTrades('intraday')
    expect(res.status).toBe(200)
    expect(logoByName(res.body.data.items)).toEqual({
      TATASTEEL: LOGO('TATASTEEL'),
      'Ambuja Cements Ltd': LOGO('AMBUJACEM'),
      'ambuja cements ltd': LOGO('AMBUJACEM'),
      'Something Else': null,
    })
  })

  it('reaches the app too', async () => {
    const res = await mobileTrades('intraday')
    expect(res.status).toBe(200)
    expect(logoByName(res.body.data.items)).toMatchObject({ TATASTEEL: LOGO('TATASTEEL'), 'Something Else': null })
  })
})

describe('a board with no stocks at all', () => {
  it('still lists its trades, every logo null', async () => {
    await swingTrade('Kotak Bank', 'KOTAKBANK', 3)
    const res = await adminTrades('swing')
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0].logoUrl).toBeNull()
  })
})
