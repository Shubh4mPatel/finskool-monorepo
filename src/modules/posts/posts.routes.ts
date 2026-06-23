import { Router } from 'express'
import { PostsService } from './posts.service.js'
import { PostsController } from './posts.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PostsService(prisma)
const controller = new PostsController(service)

const router = Router()

// All routes require authentication
router.use(authenticate)

// Accessible to any authenticated user
router.get('/', controller.list)

// Admin-only below
router.use(requireRole('admin'))

router.get('/upload-url', controller.getUploadUrl)
router.post('/', controller.create)
router.patch('/:id', controller.update)
router.delete('/:id', controller.delete)
router.patch('/:id/publish', controller.publish)
router.patch('/:id/pin', controller.pin)

export default router
