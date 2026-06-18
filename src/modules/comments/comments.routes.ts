import { Router } from 'express'
import { CommentsService } from './comments.service.js'
import { CommentsController } from './comments.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new CommentsService(prisma)
const controller = new CommentsController(service)

const router = Router()

// mounted at /api/v1 — full paths defined here
router.post('/posts/:postId/comments', authenticate, controller.create)
router.get('/posts/:postId/comments', authenticate, controller.list)
router.delete('/comments/:id', authenticate, controller.delete)

export default router
