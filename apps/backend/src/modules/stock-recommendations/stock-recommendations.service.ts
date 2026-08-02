import type { PrismaClient } from '../../generated/prisma/client.js'
import { assertCommunityAccessFromToken } from '../../lib/community-access.js'
import { liveStockFeed } from '../../lib/live-stock-feed.js'
import { notificationsQueue, COMMUNITY_RECOMMENDATION_JOB } from '../../lib/queue.js'
import { marketStatus } from '../../sockets/angelone/market-status.js'
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

    // Fire-and-forget: start streaming live price ticks for this stock right
    // away rather than waiting for the next AngelOne reconnect to pick it up.
    // Stock-level, not community-level — only needs to happen once regardless of fan-out.
    liveStockFeed.ensureSubscribed(data.stockId).catch(err => {
      logger.error({ err, stockId: data.stockId }, 'stock-recommendations.create: failed to subscribe live feed')
    })

    // Each community gets its own notification job — a failure on one shouldn't drop the
    // others, so each is caught independently rather than one try/catch around the batch.
    await Promise.all(
      recs.map(rec =>
        notificationsQueue.add(
          COMMUNITY_RECOMMENDATION_JOB,
          {
            communityId: rec.communityId,
            recommendationId: rec.id,
            message: `New recommendation: ${rec.stock.symbol} — ${rec.actionCall.toUpperCase()}`,
            triggeredByUserId: adminId,
            stockSymbol: rec.stock.symbol,
          },
          {
            jobId: `recommendation-created-${rec.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: { count: 500 },
          },
        ).catch(err => {
          // Creation already succeeded at the DB level — a queue/Redis outage
          // shouldn't fail the request.
          logger.error({ err, recommendationId: rec.id }, 'stock-recommendations.create: failed to enqueue notification job')
        }),
      ),
    )

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
    stock: { symbol: string; name: string; sector: string | null; exchange: 'nse' | 'bse' | null; cmp: unknown; closePrice: unknown }
  }): StockRecommendationResponseDTO {
    const entryPrice = Number(rec.entryPrice)
    // While the market's live, prefer the AngelOne tick-fed cmp; once it's
    // closed, ticks stop and cmp just freezes on whatever it last was, so
    // prefer the deliberately-fetched daily close instead. Either falls back
    // to the other if the preferred one hasn't been populated yet.
    const rawCmp = rec.stock.cmp !== null ? Number(rec.stock.cmp) : null
    const rawClose = rec.stock.closePrice !== null ? Number(rec.stock.closePrice) : null
    const cmp = marketStatus.isMarketLive() ? (rawCmp ?? rawClose) : (rawClose ?? rawCmp)

    return {
      id: rec.id,
      communityId: rec.communityId,
      recommendedBy: rec.recommendedBy,
      stockId: rec.stockId,
      symbol: rec.stock.symbol,
      name: rec.stock.name,
      sector: rec.stock.sector,
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
