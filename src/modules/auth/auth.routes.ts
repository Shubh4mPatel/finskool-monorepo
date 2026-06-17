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
router.post('/refresh', controller.refresh)
router.post('/logout', controller.logout)
router.get('/me', authenticate, controller.me)

export default router
