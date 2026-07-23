import type { PrismaClient } from '../../generated/prisma/client.js'
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

    return stocks.map(s => ({
      id: s.id,
      name: s.name,
      symbol: s.symbol,
      sector: s.sector,
      cmp: s.cmp !== null ? Number(s.cmp) : null,
    }))
  }
}
