import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// Long Term and US Investment sheets carry only date, name, code, entry, CMP, returns and an analysis note. The
// admin and the app must both get those and nothing invented: no target, target price, status, exit date or
// holding days, no hit-rate period cards. The Investor segment keeps all of them.

const app = createApp()
let boss: TestAdmin
let communityId: string

const admin = (path: string) => `/api/v1/admin/performance/communities/${communityId}${path}`
const NOT_FOR_HOLDINGS = ['targetPct', 'targetPrice', 'status', 'exitDate', 'holdingDays']

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  const community = await createCommunity(boss.id, { name: 'Investor Community' })
  communityId = community.id
  await prisma.performanceBoard.create({ data: { communityId, kind: 'investor' } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Long Term and US Investment rows', () => {
  it.each(['long_term', 'us_investment'] as const)('%s: an upload keeps the sheet columns and drops target / exit date', async segment => {
    const res = await request(app)
      .post(admin('/import'))
      .set('Authorization', boss.auth)
      .send({
        segment,
        rows: [
          // A sheet that still carries Investor-style columns must not smuggle them in.
          { row: 7, tradeDate: '2025-03-09', name: 'Adani Ports & SEZ', symbol: 'adaniports', entryPrice: 714, cmp: 1918.7, analysis: 'Hold', targetPct: 30, exitDate: '2025-09-01' },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })

    const stored = await prisma.performanceTrade.findFirstOrThrow({ where: { boardId: (await prisma.performanceBoard.findFirstOrThrow({ where: { communityId } })).id, segment } })
    expect(stored.targetPct).toBeNull()
    expect(stored.exitDate).toBeNull()
  })

  it('the admin list and the overview have no target fields', async () => {
    await request(app)
      .post(admin('/trades'))
      .set('Authorization', boss.auth)
      .send({ segment: 'long_term', tradeDate: '2025-03-09', name: 'Adani Ports', symbol: 'ADANIPORTS', entryPrice: 714, cmp: 1918.7, analysis: 'Hold' })
      .expect(201)

    const list = await request(app).get(admin('/trades?segment=long_term')).set('Authorization', boss.auth)
    const row = list.body.data.items[0]
    expect(row).toMatchObject({ name: 'Adani Ports', symbol: 'ADANIPORTS', entryPrice: 714, cmp: 1918.7, returnPct: 168.73, analysis: 'Hold' })
    for (const key of NOT_FOR_HOLDINGS) expect(row).not.toHaveProperty(key)

    const overview = await request(app).get(admin('/overview?segment=long_term')).set('Authorization', boss.auth)
    expect(overview.body.data.summary).toEqual({ kind: 'holding', totalTrades: 1 })
  })

  it('Add trade ignores a target or exit date sent for a holding', async () => {
    const res = await request(app)
      .post(admin('/trades'))
      .set('Authorization', boss.auth)
      .send({ segment: 'us_investment', tradeDate: '2026-06-05', name: 'Eli Lilly', symbol: 'LLY', entryPrice: 1147, targetPct: 25, exitDate: '2026-07-01' })
    expect(res.status).toBe(201)
    const stored = await prisma.performanceTrade.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(stored.targetPct).toBeNull()
    expect(stored.exitDate).toBeNull()
  })

  it('period cards cannot be added to a holding segment', async () => {
    const res = await request(app)
      .post(admin('/periods'))
      .set('Authorization', boss.auth)
      .send({ segment: 'long_term', fromMonth: '2026-01', toMonth: '2026-03' })
    expect(res.status).toBe(400)
  })

  it('the Investor segment keeps its target, exit date and period cards', async () => {
    await request(app)
      .post(admin('/trades'))
      .set('Authorization', boss.auth)
      .send({ segment: 'investor', tradeDate: '2025-01-20', name: 'Waaree', symbol: 'WAAREERTL', entryPrice: 1080, cmp: 755.35, targetPct: 20, exitDate: '2025-10-27' })
      .expect(201)
    const list = await request(app).get(admin('/trades?segment=investor')).set('Authorization', boss.auth)
    expect(list.body.data.items[0]).toMatchObject({ targetPct: 20, targetPrice: 1296, status: 'target_met', holdingDays: 280 })
    const overview = await request(app).get(admin('/overview?segment=investor')).set('Authorization', boss.auth)
    expect(overview.body.data.summary).toMatchObject({ kind: 'investor', averageHoldingDays: 280 })
  })
})

describe('the app gets the same data as the admin', () => {
  it('a long_term row and summary on mobile match the admin shape', async () => {
    const board = await prisma.performanceBoard.findFirstOrThrow({ where: { communityId } })
    await prisma.performanceTrade.create({
      data: {
        boardId: board.id,
        segment: 'long_term',
        name: 'Adani Ports',
        symbol: 'ADANIPORTS',
        entryPrice: 714,
        cmp: 1918.7,
        analysis: 'Hold',
        tradeKey: `${daysFromNow(-30)}|ADANIPORTS`,
        tradeDate: new Date(daysFromNow(-30)),
        visibility: 'show',
      },
    })
    const member = await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(30) }] })
    const res = await request(app).get(`/api/v1/mobile/performance/communities/${communityId}?segment=long_term`).set('Cookie', mobileCookie(member))
    expect(res.status).toBe(200)
    expect(res.body.data.summary).toEqual({ kind: 'holding', totalTrades: 1 })
    const row = res.body.data.items[0]
    expect(row).toMatchObject({ name: 'Adani Ports', symbol: 'ADANIPORTS', cmp: 1918.7, returnPct: 168.73, analysis: 'Hold' })
    for (const key of NOT_FOR_HOLDINGS) expect(row).not.toHaveProperty(key)
  })
})
