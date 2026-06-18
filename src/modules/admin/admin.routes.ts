import { Router } from 'express'
import multer from 'multer'
import { AdminService } from './admin.service.js'
import { AdminController } from './admin.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME_TYPES.has(file.mimetype))
  },
})

const service = new AdminService(prisma)
const controller = new AdminController(service)

const router = Router()

router.post(
  '/import-csv',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  controller.importCsv,
)

export default router
