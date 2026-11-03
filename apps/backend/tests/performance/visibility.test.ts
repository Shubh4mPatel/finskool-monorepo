import { describe, it, expect } from 'vitest'
import { freeVisibleIds, type VisibilityInput, type TradeVisibility } from '../../src/modules/performance/performance.visibility.js'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const TODAY = d('2026-10-31')
const RULES = { hideNewerThanDays: 7, maxFreeTrades: 3 }

let n = 0
const trade = (id: string, tradeDate: string, visibility: TradeVisibility = 'auto'): VisibilityInput => ({
  id,
  tradeDate: d(tradeDate),
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)),
  visibility,
})

const ids = (set: Set<string>) => [...set].sort()

describe('free member visibility', () => {
  it('hides auto trades newer than N days and shows the M newest of the rest', () => {
    const trades = [
      trade('new', '2026-10-30'), // 1 day old: too new
      trade('a', '2026-10-20'),
      trade('b', '2026-10-15'),
      trade('c', '2026-10-10'),
      trade('d', '2026-10-05'), // fourth eligible: over the quota
    ]
    expect(ids(freeVisibleIds(trades, RULES, TODAY))).toEqual(['a', 'b', 'c'])
  })

  it('a trade exactly N days old is eligible; one day newer is not', () => {
    const trades = [trade('edge', '2026-10-24'), trade('inside', '2026-10-25')]
    expect(ids(freeVisibleIds(trades, RULES, TODAY))).toEqual(['edge'])
  })

  it('hide wins over everything', () => {
    const trades = [trade('a', '2026-10-01', 'hide'), trade('b', '2026-10-02')]
    expect(ids(freeVisibleIds(trades, RULES, TODAY))).toEqual(['b'])
  })

  it('show is visible even when brand new, and does not use up the quota', () => {
    const trades = [
      trade('fresh', '2026-10-31', 'show'),
      trade('a', '2026-10-20'),
      trade('b', '2026-10-15'),
      trade('c', '2026-10-10'),
      trade('d', '2026-10-05'),
    ]
    expect(ids(freeVisibleIds(trades, RULES, TODAY))).toEqual(['a', 'b', 'c', 'fresh'])
  })

  it('a hidden or shown trade does not take a slot from the auto ones', () => {
    const trades = [trade('h', '2026-10-20', 'hide'), trade('a', '2026-10-19'), trade('b', '2026-10-18'), trade('c', '2026-10-17')]
    expect(ids(freeVisibleIds(trades, RULES, TODAY))).toEqual(['a', 'b', 'c'])
  })

  it('maxFreeTrades 0 leaves only the shown ones', () => {
    const trades = [trade('s', '2026-10-01', 'show'), trade('a', '2026-10-02')]
    expect(ids(freeVisibleIds(trades, { hideNewerThanDays: 7, maxFreeTrades: 0 }, TODAY))).toEqual(['s'])
  })

  it('hideNewerThanDays 0 makes today\'s auto trades eligible', () => {
    const trades = [trade('today', '2026-10-31')]
    expect(ids(freeVisibleIds(trades, { hideNewerThanDays: 0, maxFreeTrades: 3 }, TODAY))).toEqual(['today'])
  })

  it('same-day trades are ordered by upload time, newest first', () => {
    const first = trade('first', '2026-10-01')
    const second = trade('second', '2026-10-01')
    expect(ids(freeVisibleIds([first, second], { hideNewerThanDays: 7, maxFreeTrades: 1 }, TODAY))).toEqual(['second'])
  })

  it('nothing in, nothing out', () => {
    expect(freeVisibleIds([], RULES, TODAY).size).toBe(0)
  })
})
