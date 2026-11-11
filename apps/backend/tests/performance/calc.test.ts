import { describe, it, expect } from 'vitest'
import {
  intradayTrade,
  intradaySummary,
  holdingTrade,
  swingTrade,
  averageHoldingDays,
  periodStats,
  round2,
  roundRupee,
  type IntradayParams,
  type SwingStatus,
} from '../../src/modules/performance/performance.calc.js'

// The expected numbers below are the rows on the admin Performance designs, so a change to the formulas that
// disagrees with what the admin was shown fails here.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const PARAMS: IntradayParams = { capital: 50_000, margin: 5, chargesPerTrade: 140 }

describe('rounding', () => {
  it('rounds to 2 decimals without the 1.005 float surprise', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(3.3949)).toBe(3.39)
  })

  it('rounds rupees away from zero on halves', () => {
    expect(roundRupee(1697.5)).toBe(1698)
    expect(roundRupee(-1697.5)).toBe(-1698)
    expect(roundRupee(-1697.4)).toBe(-1697)
  })
})

describe('intraday trade', () => {
  const rows: [string, 'buy' | 'sell', number, number, number, number, number, number][] = [
    // name, side, entry, exit, P/L per share, P/L %, gross P&L, net P&L
    ['Ambuja Cement', 'buy', 368.2, 365.7, -2.5, -3.39, -1697, -1837],
    ['CAMS', 'sell', 687.55, 682.1, 5.45, 3.96, 1982, 1842],
    ['Radico Khaitan', 'sell', 4394.5, 4421.3, -26.8, -3.05, -1525, -1665],
    ['IEX', 'sell', 106.9, 106.6, 0.3, 1.4, 702, 562],
    ['Bank of Baroda', 'sell', 238, 236.1, 1.9, 3.99, 1996, 1856],
    ['LIC Housing Finance', 'sell', 549.5, 553.4, -3.9, -3.55, -1774, -1914],
    ['Astral', 'sell', 1432, 1424.8, 7.2, 2.51, 1257, 1117],
    ['LTM', 'sell', 4120, 4148, -28, -3.4, -1699, -1839],
    ['Adani Green', 'sell', 1220.85, 1225, -4.15, -1.7, -850, -990],
  ]

  it.each(rows)('%s', (_name, side, entryPrice, exitPrice, plPerShare, plPct, grossPnl, netPnl) => {
    expect(intradayTrade({ side, entryPrice, exitPrice }, PARAMS)).toEqual({
      plPerShare,
      plPct,
      grossPnl,
      charges: 140,
      netPnl,
    })
  })

  it('re-prices when the board parameters change', () => {
    const r = intradayTrade({ side: 'buy', entryPrice: 100, exitPrice: 101 }, { capital: 100_000, margin: 2, chargesPerTrade: 50 })
    // 100000 x 2 / 100 = 2000 shares, 1 rupee each
    expect(r).toEqual({ plPerShare: 1, plPct: 2, grossPnl: 2000, charges: 50, netPnl: 1950 })
  })

  it('a flat trade is zero gross and costs the charges', () => {
    const r = intradayTrade({ side: 'buy', entryPrice: 250, exitPrice: 250 }, PARAMS)
    expect(r.grossPnl).toBe(0)
    expect(r.netPnl).toBe(-140)
  })
})

describe('intraday summary', () => {
  it('adds up the board and counts profit / loss share over all trades', () => {
    const results = [
      intradayTrade({ side: 'buy', entryPrice: 368.2, exitPrice: 365.7 }, PARAMS), // -1697
      intradayTrade({ side: 'sell', entryPrice: 687.55, exitPrice: 682.1 }, PARAMS), // 1982
      intradayTrade({ side: 'sell', entryPrice: 106.9, exitPrice: 106.6 }, PARAMS), // 702
      intradayTrade({ side: 'buy', entryPrice: 250, exitPrice: 250 }, PARAMS), // 0
    ]
    expect(intradaySummary(results, PARAMS)).toEqual({
      capitalDeployed: 50_000,
      grossPnl: 987,
      totalCharges: 560,
      overallPnl: 427,
      totalTrades: 4,
      profitMakingTrades: 2,
      lossMakingTrades: 1,
      profitMakingPct: 50,
      lossMakingPct: 25,
    })
  })

  it('an empty board is all zeros, not NaN', () => {
    const s = intradaySummary([], PARAMS)
    expect(s.totalTrades).toBe(0)
    expect(s.profitMakingPct).toBe(0)
    expect(s.lossMakingPct).toBe(0)
    expect(s.overallPnl).toBe(0)
  })
})

describe('swing trade', () => {
  const open = (entryPrice: number, cmp: number | null, targetPct: number | null = null) =>
    swingTrade({ tradeDate: d('2026-08-01'), entryPrice, cmp, targetPct, exitDate: null }, 'swing')

  it.each([
    ['Hindustan Copper', 537, 399.85, 563.85, -25.54],
    ['Airtel', 1938, 1973.7, 2034.9, 1.84],
    ['Capri Global', 275, 229.92, 288.75, -16.39],
    ['Mazagon Dock', 2095, 1705.3, 2199.75, -18.6],
    ['Kotak Mahindra Bank', 459, 461.6, 481.95, 0.57],
  ])('%s: open, 5%% target', (_name, entry, cmp, targetPrice, returnPct) => {
    expect(open(entry, cmp)).toEqual({ targetPct: 5, targetPrice, returnPct, status: 'open', holdingDays: null })
  })

  it('an exit date means the target was met, and gives the holding days', () => {
    const bls = swingTrade(
      { tradeDate: d('2026-08-12'), entryPrice: 262, cmp: 209.98, targetPct: null, exitDate: d('2026-08-14') },
      'swing',
    )
    // CMP is below entry, yet the target was met on the way: status never comes from CMP.
    expect(bls).toEqual({ targetPct: 5, targetPrice: 275.1, returnPct: -19.85, status: 'target_met', holdingDays: 2 })

    const balrampur = swingTrade(
      { tradeDate: d('2026-08-19'), entryPrice: 659, cmp: 589.45, targetPct: null, exitDate: d('2026-08-20') },
      'swing',
    )
    expect(balrampur.holdingDays).toBe(1)
    expect(balrampur.targetPrice).toBe(691.95)
  })

  it('investor trades default to a 10% target and holding days span months', () => {
    const gng = swingTrade(
      { tradeDate: d('2026-08-24'), entryPrice: 614, cmp: 660.5, targetPct: null, exitDate: d('2026-09-09') },
      'investor',
    )
    expect(gng.targetPct).toBe(10)
    expect(gng.targetPrice).toBe(675.4)
    expect(gng.holdingDays).toBe(16)

    const skipper = swingTrade(
      { tradeDate: d('2026-08-12'), entryPrice: 543, cmp: 491.8, targetPct: null, exitDate: d('2026-09-07') },
      'investor',
    )
    expect(skipper.targetPrice).toBe(597.3)
    expect(skipper.holdingDays).toBe(26)
  })

  it('a target from the sheet wins over the default', () => {
    expect(open(100, 100, 8).targetPrice).toBe(108)
  })

  it('no CMP means no return, not zero', () => {
    expect(open(100, null).returnPct).toBeNull()
  })
})

describe('average holding days', () => {
  const closed = (days: number) => ({ ...swingTrade({ tradeDate: d('2026-01-01'), entryPrice: 1, cmp: null, targetPct: null, exitDate: new Date(d('2026-01-01').getTime() + days * 86_400_000) }, 'swing') })
  const open = swingTrade({ tradeDate: d('2026-01-01'), entryPrice: 1, cmp: null, targetPct: null, exitDate: null }, 'swing')

  it('averages closed trades only, to 1 decimal', () => {
    expect(averageHoldingDays([closed(2), closed(1), closed(34), open])).toBe(12.3)
  })

  it('is null before anything has closed', () => {
    expect(averageHoldingDays([open])).toBeNull()
    expect(averageHoldingDays([])).toBeNull()
  })
})

describe('period stats', () => {
  const trade = (iso: string, status: SwingStatus) => ({ tradeDate: d(iso), status })

  it('matches the Oct25 to Aug26 card: 34 of 44 met is 77.27%', () => {
    const trades = [
      ...Array.from({ length: 34 }, () => trade('2026-03-10', 'target_met')),
      ...Array.from({ length: 10 }, () => trade('2026-05-10', 'open')),
      trade('2026-09-15', 'target_met'), // after the period
      trade('2025-09-30', 'target_met'), // before it
    ]
    expect(periodStats(trades, d('2025-10-01'), d('2026-08-01'))).toEqual({ given: 44, met: 34, metPct: 77.27 })
  })

  it('includes the whole of the first and last month', () => {
    const trades = [
      trade('2026-01-01', 'open'),
      trade('2026-03-31', 'target_met'),
      trade('2025-12-31', 'open'),
      trade('2026-04-01', 'open'),
    ]
    expect(periodStats(trades, d('2026-01-01'), d('2026-03-01'))).toEqual({ given: 2, met: 1, metPct: 50 })
  })

  it('an empty period is 0%, not NaN', () => {
    expect(periodStats([], d('2026-01-01'), d('2026-03-01'))).toEqual({ given: 0, met: 0, metPct: 0 })
  })
})

describe('holdings (Long Term / US Investment)', () => {
  it('works out only the return against CMP, with no target, status or holding days', () => {
    expect(holdingTrade({ entryPrice: 714, cmp: 1918.7 })).toEqual({ returnPct: 168.73 })
    expect(holdingTrade({ entryPrice: 607, cmp: 458.45 })).toEqual({ returnPct: -24.47 })
  })

  it('has no return while there is no CMP', () => {
    expect(holdingTrade({ entryPrice: 100, cmp: null })).toEqual({ returnPct: null })
  })
})
