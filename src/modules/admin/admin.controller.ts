import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { AdminService } from './admin.service.js'
import { BadRequestError } from '../../shared/errors/index.js'

const importQuerySchema = z.object({
  duplicateStrategy: z.enum(['skip', 'overwrite']).default('skip'),
})

export class AdminController {
  constructor(private readonly service: AdminService) {}

  importCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded. Send a CSV or Excel file in the "file" field.')

      const { duplicateStrategy } = importQuerySchema.parse(req.query)
      const result = await this.service.importUsers(req.file.buffer, req.user!.id, duplicateStrategy)
      res.status(200).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
