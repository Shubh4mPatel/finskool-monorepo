// Daily close-price sweep against the Finedge quote API. Runs once a day
// (see the 'daily-close-price' job scheduler registered in index.ts) well
// after market close, so unlike the AngelOne tick feed (live-stock-feed.ts)
// this deliberately captures a stable price rather than whatever happened to
// be the last tick before the feed went quiet.
import type { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'
import { logger } from '../shared/logger.js'

const BATCH_SIZE = 5 // stays under Finedge's 300 req/min (5 req/sec) rate limit
const BATCH_PAUSE_MS = 1000

interface QuoteData {
  ltp: number
  [key: string]: unknown
}

async function fetchQuote(symbol: string): Promise<QuoteData> {
  const url = `${env.stockQuoteApi.baseUrl}/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${env.stockQuoteApi.apiKey}`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })

  if (!res.ok) throw new Error(`Finedge ${symbol}: ${res.status} ${res.statusText}`)

  const json = (await res.json()) as Record<string, QuoteData>
  const data = json[symbol]
  if (!data) throw new Error(`Symbol "${symbol}" not found in Finedge response`)

  return data
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function refreshAllStockClosePrices(db: PrismaClient): Promise<{ total: number; updated: number; failed: number }> {
  const stocks = await db.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true },
  })

  let updated = 0
  let failed = 0

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async stock => {
      try {
        const quote = await fetchQuote(stock.symbol)
        if (typeof quote.ltp !== 'number' || !Number.isFinite(quote.ltp)) {
          throw new Error(`missing/invalid ltp: ${JSON.stringify(quote.ltp)}`)
        }
        await db.stock.update({ where: { id: stock.id }, data: { closePrice: quote.ltp } })
        updated++
      } catch (err) {
        failed++
        logger.warn({ err, symbol: stock.symbol }, 'refreshAllStockClosePrices: failed to update close price')
      }
    }))

    if (i + BATCH_SIZE < stocks.length) await sleep(BATCH_PAUSE_MS)
  }

  logger.info({ total: stocks.length, updated, failed }, 'refreshAllStockClosePrices: sweep complete')
  return { total: stocks.length, updated, failed }
}
