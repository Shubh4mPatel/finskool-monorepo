import { Router } from 'express'
import { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'
import redis from '../../lib/redis.js'

const service = new AuthService(prisma, redis)
const controller = new AuthController(service)

const router = Router()

router.post('/register', controller.register)
router.post('/login', controller.login)
router.get('/refresh', controller.refresh)
router.post('/logout', controller.logout)
router.post('/select-community', authenticate, controller.selectCommunity)
router.get('/me', authenticate, controller.me)
router.patch('/me/email', authenticate, controller.updateEmail)
router.patch('/me/password', authenticate, controller.changePassword)
router.patch('/me/notifications', authenticate, controller.updateNotifications)
router.get('/me/avatar/upload-url', authenticate, controller.getAvatarUploadUrl)
router.patch('/me/avatar', authenticate, controller.updateAvatar)

export default router
