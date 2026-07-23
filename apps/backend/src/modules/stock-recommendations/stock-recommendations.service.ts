import type { PrismaClient } from '../../generated/prisma/client.js'
import { assertCommunityAccess } from '../../lib/community-access.js'
import { liveStockFeed } from '../../lib/live-stock-feed.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  CreateStockRecommendationDTO,
  UpdateStockRecommendationDTO,
  StockRecommendationResponseDTO,
} from './stock-recommendations.dto.js'

const withStock = { include: { stock: true as const } }

export class StockRecommendationsService {
  constructor(private readonly db: PrismaClient) {}

  async listRecommendations(params: {
    communityId?: string
    communityIds?: string[]
  }): Promise<StockRecommendationResponseDTO[]> {
    const { communityId, communityIds } = params
    const where = {
      deletedAt: null,
      ...(communityId !== undefined
        ? { communityId }
        : communityIds !== undefined
          ? { communityId: { in: communityIds } }
          : {}),
    }

    const recs = await this.db.stockRecommendation.findMany({
      where,
      ...withStock,
      orderBy: { createdAt: 'desc' as const },
    })

    return recs.map(r => this.toResponse(r))
  }

  async createRecommendation(
    adminId: string,
    data: CreateStockRecommendationDTO,
  ): Promise<StockRecommendationResponseDTO> {
    const community = await this.db.community.findUnique({
      where: { id: data.communityId, deletedAt: null },
    })
    if (!community) throw new NotFoundError('Community not found')
    await assertCommunityAccess(this.db, adminId, data.communityId)

    const stock = await this.db.stock.findUnique({ where: { id: data.stockId } })
    if (!stock) throw new NotFoundError('Stock not found')

    const rec = await this.db.stockRecommendation.create({
      data: {
        communityId: data.communityId,
        recommendedBy: adminId,
        stockId: data.stockId,
        entryPrice: data.entryPrice,
        targetPrice: data.targetPrice,
        stopLossPrice: data.stopLossPrice,
        actionCall: data.actionCall,
        riskLevel: data.riskLevel,
        recommendationNotes: data.recommendationNotes ?? null,
      },
      ...withStock,
    })

    logger.info({ recommendationId: rec.id }, 'stock-recommendations.create: success')

    // Fire-and-forget: start streaming live price ticks for this stock right
    // away rather than waiting for the next AngelOne reconnect to pick it up.
    liveStockFeed.ensureSubscribed(data.stockId).catch(err => {
      logger.error({ err, stockId: data.stockId }, 'stock-recommendations.create: failed to subscribe live feed')
    })

    return this.toResponse(rec)
  }

  async updateRecommendation(
    id: string,
    adminId: string,
    data: UpdateStockRecommendationDTO,
  ): Promise<StockRecommendationResponseDTO> {
    const rec = await this.db.stockRecommendation.findUnique({ where: { id, deletedAt: null } })
    if (!rec) throw new NotFoundError('Recommendation not found')
    await assertCommunityAccess(this.db, adminId, rec.communityId)

    const updated = await this.db.stockRecommendation.update({
      where: { id },
      data: {
        ...(data.entryPrice !== undefined && { entryPrice: data.entryPrice }),
        ...(data.targetPrice !== undefined && { targetPrice: data.targetPrice }),
        ...(data.stopLossPrice !== undefined && { stopLossPrice: data.stopLossPrice }),
        ...(data.actionCall !== undefined && { actionCall: data.actionCall }),
        ...(data.riskLevel !== undefined && { riskLevel: data.riskLevel }),
        ...(data.recommendationNotes !== undefined && { recommendationNotes: data.recommendationNotes }),
      },
      ...withStock,
    })

    logger.info({ recommendationId: id }, 'stock-recommendations.update: success')
    return this.toResponse(updated)
  }

  async deleteRecommendation(id: string, adminId: string): Promise<void> {
    const rec = await this.db.stockRecommendation.findUnique({ where: { id, deletedAt: null } })
    if (!rec) throw new NotFoundError('Recommendation not found')
    await assertCommunityAccess(this.db, adminId, rec.communityId)

    await this.db.stockRecommendation.update({ where: { id }, data: { deletedAt: new Date() } })
    logger.info({ recommendationId: id }, 'stock-recommendations.delete: soft deleted')
  }

  private toResponse(rec: {
    id: string
    communityId: string
    recommendedBy: string
    stockId: string
    entryPrice: unknown
    targetPrice: unknown
    stopLossPrice: unknown
    actionCall: string
    riskLevel: string
    recommendationNotes: string | null
    createdAt: Date
    updatedAt: Date
    stock: { symbol: string; name: string; sector: string | null; cmp: unknown }
  }): StockRecommendationResponseDTO {
    const entryPrice = Number(rec.entryPrice)
    const cmp = rec.stock.cmp !== null ? Number(rec.stock.cmp) : null

    return {
      id: rec.id,
      communityId: rec.communityId,
      recommendedBy: rec.recommendedBy,
      stockId: rec.stockId,
      symbol: rec.stock.symbol,
      name: rec.stock.name,
      sector: rec.stock.sector,
      cmp,
      entryPrice,
      targetPrice: Number(rec.targetPrice),
      stopLossPrice: Number(rec.stopLossPrice),
      actionCall: rec.actionCall,
      riskLevel: rec.riskLevel,
      recommendationNotes: rec.recommendationNotes,
      returnPercent:
        cmp !== null && entryPrice !== 0
          ? Number((((cmp - entryPrice) / entryPrice) * 100).toFixed(2))
          : null,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    }
  }
}
