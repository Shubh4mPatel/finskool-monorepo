import { Router } from 'express'
import { PostsService } from './posts.service.js'
import { PostsController } from './posts.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PostsService(prisma)
const controller = new PostsController(service)

const router = Router()

const admin = requireRole('admin')

// All routes require authentication
router.use(authenticate)

// Any authenticated user
router.get('/', controller.list)
router.get('/my-comments', controller.listCommented)

// Admin-only — requireRole applied inline so it doesn't bleed into comment routes
// that share the /api/v1/posts prefix (e.g. POST /api/v1/posts/:id/comments)
router.get('/upload-url', admin, controller.getUploadUrl)
router.post('/', admin, controller.create)
router.patch('/:id', admin, controller.update)
router.delete('/:id', admin, controller.delete)
router.patch('/:id/publish', admin, controller.publish)
router.patch('/:id/pin', admin, controller.pin)

export default router
