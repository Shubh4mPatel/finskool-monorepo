export interface CreateStockRecommendationDTO {
  communityId: string
  stockId: string
  entryPrice: number
  targetPrice: number
  stopLossPrice: number
  actionCall: 'buy' | 'hold' | 'exit'
  riskLevel: 'low' | 'medium' | 'high'
  recommendationNotes?: string | undefined
}

export interface UpdateStockRecommendationDTO {
  entryPrice?: number | undefined
  targetPrice?: number | undefined
  stopLossPrice?: number | undefined
  actionCall?: 'buy' | 'hold' | 'exit' | undefined
  riskLevel?: 'low' | 'medium' | 'high' | undefined
  recommendationNotes?: string | undefined
}

export interface StockRecommendationResponseDTO {
  id: string
  communityId: string
  recommendedBy: string
  stockId: string
  symbol: string
  name: string
  sector: string | null
  cmp: number | null
  entryPrice: number
  targetPrice: number
  stopLossPrice: number
  actionCall: string
  riskLevel: string
  recommendationNotes: string | null
  returnPercent: number | null
  createdAt: Date
  updatedAt: Date
}
