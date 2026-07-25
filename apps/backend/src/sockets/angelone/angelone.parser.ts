import type { SnapQuoteTick, BestFiveEntry } from './angelone.types.js'
import { EXCHANGE_LABEL } from './angelone.config.js'

/**
 * Parses the AngelOne SmartAPI binary WebSocket packet (Little Endian).
 *
 * Packet sizes:
 *   LTP packet       =  51 bytes
 *   Quote packet     = 123 bytes
 *   SnapQuote packet = 379 bytes
 */
export function parsePacket(buf: Buffer): SnapQuoteTick | null {
  if (buf.length < 51) return null

  const mode = buf.readInt8(0)
  const exchangeType = buf.readInt8(1)
  const tokenId = buf.slice(2, 27).toString('utf8').replace(/\0/g, '').trim()
  const exchange = EXCHANGE_LABEL[exchangeType] ?? String(exchangeType)
  const seqNo = buf.readBigInt64LE(27).toString()
  const exchTsRaw = Number(buf.readBigInt64LE(35))
  const exchTs = exchTsRaw > 0 ? new Date(exchTsRaw).toISOString() : null
  const ltp = Number(buf.readBigInt64LE(43)) / 100

  if (mode === 1 || buf.length < 123) {
    return { mode, exchange, tokenId, seqNo, exchTs, ltp }
  }

  // Quote (mode 2) fields — bytes 51–122
  const ltq = Number(buf.readBigInt64LE(51))
  const atp = Number(buf.readBigInt64LE(59)) / 100
  const volume = Number(buf.readBigInt64LE(67))
  const buyQty = buf.readDoubleLE(75)
  const selQty = buf.readDoubleLE(83)
  const open = Number(buf.readBigInt64LE(91)) / 100
  const high = Number(buf.readBigInt64LE(99)) / 100
  const low = Number(buf.readBigInt64LE(107)) / 100
  const close = Number(buf.readBigInt64LE(115)) / 100

  const base: SnapQuoteTick = {
    mode, exchange, tokenId, seqNo, exchTs, ltp,
    ltq, atp, volume, buyQty, selQty, open, high, low, close,
  }

  if (mode !== 3 || buf.length < 379) return base

  // SnapQuote (mode 3) extra fields — bytes 123–378
  const ltTsRaw = Number(buf.readBigInt64LE(123))
  const ltTs = ltTsRaw > 0 ? new Date(ltTsRaw).toISOString() : null
  const openInt = Number(buf.readBigInt64LE(131))
  // bytes 139–146: OI change % — reserved/garbage per docs, skip

  // Best Five — 10 entries × 20 bytes, starting at byte 147
  const bestFive: { buy: BestFiveEntry[]; sell: BestFiveEntry[] } = { buy: [], sell: [] }
  for (let i = 0; i < 10; i++) {
    const base147 = 147 + i * 20
    const flag = buf.readInt16LE(base147) // 1=buy  0=sell
    const qty = Number(buf.readBigInt64LE(base147 + 2))
    const price = Number(buf.readBigInt64LE(base147 + 10)) / 100
    const orders = buf.readInt16LE(base147 + 18)
    const entry: BestFiveEntry = { price, qty, orders }
    if (flag === 1) bestFive.buy.push(entry)
    else bestFive.sell.push(entry)
  }

  const upperCircuit = Number(buf.readBigInt64LE(347)) / 100
  const lowerCircuit = Number(buf.readBigInt64LE(355)) / 100
  const high52w = Number(buf.readBigInt64LE(363)) / 100
  const low52w = Number(buf.readBigInt64LE(371)) / 100

  return { ...base, ltTs, openInt, bestFive, upperCircuit, lowerCircuit, high52w, low52w }
}
