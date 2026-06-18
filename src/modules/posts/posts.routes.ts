import { Router } from 'express'
import multer from 'multer'
import { PostsService } from './posts.service.js'
import { PostsController } from './posts.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per image
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype))
  },
})

const service = new PostsService(prisma)
const controller = new PostsController(service)

const router = Router()

// all post management is admin-only
router.use(authenticate, requireRole('admin'))

router.post('/', upload.array('images', 10), controller.create)
router.patch('/:id', upload.array('images', 10), controller.update)
router.delete('/:id', controller.delete)
router.patch('/:id/publish', controller.publish)
router.patch('/:id/pin', controller.pin)

export default router
