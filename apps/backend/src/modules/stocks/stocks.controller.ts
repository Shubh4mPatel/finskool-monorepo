import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { StocksService } from './stocks.service.js'

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
})

export class StocksController {
  constructor(private readonly service: StocksService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search } = listQuerySchema.parse(req.query)
      const stocks = await this.service.searchStocks(search)
      res.json({ success: true, data: stocks })
    } catch (err) {
      next(err)
    }
  }
}
