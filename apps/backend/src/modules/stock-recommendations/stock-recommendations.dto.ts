export interface CreateStockRecommendationDTO {
  communityIds: string[]
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

export interface StockRecommendationListFilters {
  communityId?: string | undefined
  communityIds?: string[] | undefined
  riskLevel?: 'low' | 'medium' | 'high' | undefined
  actionCall?: 'buy' | 'hold' | 'exit' | undefined
  search?: string | undefined
  page: number
  pageSize: number
}

export interface StockRecommendationListDTO {
  recommendations: StockRecommendationResponseDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface StockRecommendationResponseDTO {
  id: string
  communityId: string
  recommendedBy: string
  stockId: string
  symbol: string
  name: string
  sector: string | null
  logoUrl: string | null
  exchange: 'nse' | 'bse' | null
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
