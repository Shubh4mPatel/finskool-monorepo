import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'

const controller = new DashboardController(new DashboardService(prisma))

// Admin home screen — one endpoint per panel so a slow or failing panel never blocks the rest.
// Every endpoint is scoped to the caller's accessibleCommunityIds (null = super admin, unrestricted).
const router = Router()
router.use(authenticate, requireRole('admin'))

router.get('/kpis', controller.kpis)
router.get('/revenue', controller.revenue)
router.get('/expiring', controller.expiring)
router.get('/registrations', controller.registrations)
router.get('/tickets', controller.tickets)

export default router
