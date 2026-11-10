import type { PrismaClient } from '../../generated/prisma/client.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type {
  CreateStockRecommendationDTO,
  UpdateStockRecommendationDTO,
  StockRecommendationResponseDTO,
  StockRecommendationListFilters,
  StockRecommendationListDTO,
} from './stock-recommendations.dto.js'

const withStock = { include: { stock: true as const } }

export class StockRecommendationsService {
  constructor(private readonly db: PrismaClient) {}

  async listRecommendations(params: StockRecommendationListFilters): Promise<StockRecommendationListDTO> {
    const { communityId, communityIds, riskLevel, actionCall, search, page, pageSize } = params
    const where = {
      deletedAt: null,
      ...(communityId !== undefined
        ? { communityId }
        : communityIds !== undefined
          ? { communityId: { in: communityIds } }
          : {}),
      ...(riskLevel !== undefined && { riskLevel }),
      ...(actionCall !== undefined && { actionCall }),
      ...(search && {
        stock: {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { symbol: { contains: search, mode: 'insensitive' as const } },
          ],
        },
      }),
    }

    const [total, recs] = await Promise.all([
      this.db.stockRecommendation.count({ where }),
      this.db.stockRecommendation.findMany({
        where,
        ...withStock,
        orderBy: { createdAt: 'desc' as const },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      recommendations: recs.map(r => this.toResponse(r)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async createRecommendation(
    adminId: string,
    accessibleCommunityIds: string[] | null,
    data: CreateStockRecommendationDTO,
  ): Promise<StockRecommendationResponseDTO[]> {
    const communities = await this.db.community.findMany({
      where: { id: { in: data.communityIds }, deletedAt: null },
    })
    if (communities.length !== data.communityIds.length) throw new NotFoundError('Community not found')
    for (const communityId of data.communityIds) {
      assertCommunityAccessFromToken(accessibleCommunityIds, communityId)
    }

    const stock = await this.db.stock.findUnique({ where: { id: data.stockId } })
    if (!stock) throw new NotFoundError('Stock not found')

    // One row per selected community — StockRecommendation stays single-community per row,
    // so reads (listRecommendations) need no changes; this just creates several rows atomically.
    const recs = await this.db.$transaction(
      data.communityIds.map(communityId =>
        this.db.stockRecommendation.create({
          data: {
            communityId,
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
        }),
      ),
    )

    logger.info({ recommendationIds: recs.map(r => r.id), count: recs.length }, 'stock-recommendations.create: success')

    // A new recommendation does not notify members (no inbox row, push or email): they see it in the recommendations list.

    return recs.map(rec => this.toResponse(rec))
  }

  async updateRecommendation(
    id: string,
    adminId: string,
    accessibleCommunityIds: string[] | null,
    data: UpdateStockRecommendationDTO,
  ): Promise<StockRecommendationResponseDTO> {
    const rec = await this.db.stockRecommendation.findUnique({ where: { id, deletedAt: null } })
    if (!rec) throw new NotFoundError('Recommendation not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, rec.communityId)

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

  async deleteRecommendation(
    id: string,
    adminId: string,
    accessibleCommunityIds: string[] | null,
  ): Promise<void> {
    const rec = await this.db.stockRecommendation.findUnique({ where: { id, deletedAt: null } })
    if (!rec) throw new NotFoundError('Recommendation not found')
    assertCommunityAccessFromToken(accessibleCommunityIds, rec.communityId)

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
    stock: { symbol: string; name: string; sector: string | null; logoUrl: string | null; exchange: 'nse' | 'bse' | null; cmp: unknown; closePrice: unknown }
  }): StockRecommendationResponseDTO {
    const entryPrice = Number(rec.entryPrice)
    // There is no live price feed: the price is the daily close the close-price sweep fetches. The last stored
    // cmp (from before live ticks were removed) is only used for a stock that has no close yet.
    const rawCmp = rec.stock.cmp !== null ? Number(rec.stock.cmp) : null
    const rawClose = rec.stock.closePrice !== null ? Number(rec.stock.closePrice) : null
    const cmp = rawClose ?? rawCmp

    return {
      id: rec.id,
      communityId: rec.communityId,
      recommendedBy: rec.recommendedBy,
      stockId: rec.stockId,
      symbol: rec.stock.symbol,
      name: rec.stock.name,
      sector: rec.stock.sector,
      logoUrl: rec.stock.logoUrl,
      exchange: rec.stock.exchange,
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
