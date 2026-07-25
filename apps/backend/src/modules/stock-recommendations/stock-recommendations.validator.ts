import { z } from 'zod'

export const createStockRecommendationSchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
  stockId: z.string().uuid('Invalid stock'),
  entryPrice: z.number().positive('Entry price must be a positive number'),
  targetPrice: z.number().positive('Target price must be a positive number'),
  stopLossPrice: z.number().positive('Stop loss price must be a positive number'),
  actionCall: z.enum(['buy', 'hold', 'exit']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  recommendationNotes: z.string().max(2000).optional(),
})

export const updateStockRecommendationSchema = z.object({
  entryPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  actionCall: z.enum(['buy', 'hold', 'exit']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  recommendationNotes: z.string().max(2000).optional(),
})
