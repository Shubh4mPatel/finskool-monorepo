import type { PrismaClient } from '../../generated/prisma/client.js'
import { marketStatus } from '../../sockets/angelone/market-status.js'
import type { StockResponseDTO } from './stocks.dto.js'

export class StocksService {
  constructor(private readonly db: PrismaClient) {}

  async searchStocks(query?: string): Promise<StockResponseDTO[]> {
    const stocks = await this.db.stock.findMany({
      where: {
        isActive: true,
        ...(query && {
          OR: [
            { name: { contains: query, mode: 'insensitive' as const } },
            { symbol: { contains: query, mode: 'insensitive' as const } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      take: 20,
    })

    const live = marketStatus.isMarketLive()
    return stocks.map(s => {
      const rawCmp = s.cmp !== null ? Number(s.cmp) : null
      const rawClose = s.closePrice !== null ? Number(s.closePrice) : null
      return {
        id: s.id,
        name: s.name,
        symbol: s.symbol,
        sector: s.sector,
        logoUrl: s.logoUrl,
        exchange: s.exchange,
        cmp: live ? (rawCmp ?? rawClose) : (rawClose ?? rawCmp),
      }
    })
  }
}
