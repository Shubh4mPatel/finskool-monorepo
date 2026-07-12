import { Router } from 'express'
import { NotificationsService } from './notifications.service.js'
import { NotificationsController } from './notifications.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new NotificationsService(prisma)
const controller = new NotificationsController(service)

const router = Router()

// Any authenticated user (member or admin) has their own notifications — no role gate
router.use(authenticate)

router.get('/', controller.list)
router.get('/unread-count', controller.unreadCount)
router.patch('/mark-all-read', controller.markAllRead)
router.patch('/:id/read', controller.markRead)

export default router
