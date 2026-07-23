import { Router } from 'express'
import { StockRecommendationsService } from './stock-recommendations.service.js'
import { StockRecommendationsController } from './stock-recommendations.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new StockRecommendationsService(prisma)
const controller = new StockRecommendationsController(service)

const router = Router()

const admin = requireRole('admin')

// All routes require authentication
router.use(authenticate)

// Any authenticated user (admin or member) — scoping happens in the controller
router.get('/', controller.list)

// Admin-only
router.post('/', admin, controller.create)
router.patch('/:id', admin, controller.update)
router.delete('/:id', admin, controller.delete)

export default router
