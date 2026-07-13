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

router.get('/dashboard', authenticate, requireRole('admin'), controller.getDashboard)
router.post('/import-json', authenticate, requireRole('admin'), controller.importJSON)
router.post('/validate-import', authenticate, requireRole('admin'), controller.validateImport)

router.post(
  '/import-csv',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  controller.importCsv,
)

router.get('/communities', authenticate, requireRole('admin'), controller.listCommunities)

router.get('/admins', authenticate, requireRole('admin'), controller.listAdmins)
router.post('/admins/:adminId/communities', authenticate, requireRole('admin'), controller.grantCommunityAccess)
router.delete(
  '/admins/:adminId/communities/:communityId',
  authenticate,
  requireRole('admin'),
  controller.revokeCommunityAccess,
)
router.get('/members', authenticate, requireRole('admin'), controller.listMembers)
router.post('/members', authenticate, requireRole('admin'), controller.addMember)
router.post('/members/bulk-delete', authenticate, requireRole('admin'), controller.bulkDeleteMembers)
router.delete('/members/:id', authenticate, requireRole('admin'), controller.deleteMember)
router.patch('/members/:id/suspend', authenticate, requireRole('admin'), controller.suspendMember)
router.patch('/members/:id/revoke', authenticate, requireRole('admin'), controller.revokeSuspension)

router.post(
  '/subscriptions/:id/extend',
  authenticate,
  requireRole('admin'),
  controller.extendSubscription,
)

router.get('/comment-notifications', authenticate, requireRole('admin'), controller.listCommentNotifications)

router.patch(
  '/comment-notifications/:id/mark-replied',
  authenticate,
  requireRole('admin'),
  controller.markNotificationReplied,
)

router.patch(
  '/comment-notifications/mark-all-replied',
  authenticate,
  requireRole('admin'),
  controller.markAllNotificationsReplied,
)

router.get('/pending-post-threads', authenticate, requireRole('admin'), controller.listPendingPostThreads)

export default router
