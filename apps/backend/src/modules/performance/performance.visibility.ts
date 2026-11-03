// Which trades a free member may see. Pure: the caller passes one board + segment's trades and "today".
//
//   hide  never shown to free members
//   show  always shown, and does not use up the "at most M" quota (the admin asked for it by name)
//   auto  eligible once it is at least `hideNewerThanDays` old; free members see the M newest eligible ones
//
// Paid members see every trade and never go through this.

export type TradeVisibility = 'auto' | 'show' | 'hide'

export interface VisibilityRules {
  hideNewerThanDays: number
  maxFreeTrades: number
}

export interface VisibilityInput {
  id: string
  /** Calendar date, midnight UTC. */
  tradeDate: Date
  createdAt: Date
  visibility: TradeVisibility
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Newest first: trade date, then upload time, then id, so the order is total and stable. */
export function compareNewestFirst(a: VisibilityInput, b: VisibilityInput): number {
  return (
    b.tradeDate.getTime() - a.tradeDate.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  )
}

/** `today` is the current IST calendar day as a midnight-UTC date. */
export function freeVisibleIds(trades: VisibilityInput[], rules: VisibilityRules, today: Date): Set<string> {
  const visible = new Set<string>()

  const eligible: VisibilityInput[] = []
  for (const t of trades) {
    if (t.visibility === 'show') visible.add(t.id)
    else if (t.visibility === 'auto' && (today.getTime() - t.tradeDate.getTime()) / DAY_MS >= rules.hideNewerThanDays) {
      eligible.push(t)
    }
  }

  eligible.sort(compareNewestFirst)
  for (const t of eligible.slice(0, rules.maxFreeTrades)) visible.add(t.id)
  return visible
}
