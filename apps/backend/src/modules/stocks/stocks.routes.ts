import { Router } from 'express'
import { StocksService } from './stocks.service.js'
import { StocksController } from './stocks.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new StocksService(prisma)
const controller = new StocksController(service)

const router = Router()

// Only the admin recommendation-creation form consumes this — members see
// stock data joined into their recommendations, never this list directly.
router.use(authenticate, requireRole('admin'))
router.get('/', controller.list)

export default router
