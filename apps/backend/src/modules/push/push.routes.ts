import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { PushService } from './push.service.js'
import { registerPushTokenSchema, pushSettingsSchema } from './push.validator.js'
import { authenticate, requireMobileAuth } from '../../middlewares/auth.middleware.js'
import { UnauthorizedError } from '../../shared/errors/index.js'
import prisma from '../../lib/prisma.js'

const service = new PushService(prisma)

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>
const userId = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError('Not authenticated')
  return req.user.id
}

const registerToken: Handler = async (req, res, next) => {
  try {
    const body = registerPushTokenSchema.parse(req.body)
    await service.registerToken(userId(req), body.token, body.appVersion)
    res.json({ success: true, data: null })
  } catch (err) {
    next(err)
  }
}

const removeToken: Handler = async (req, res, next) => {
  try {
    await service.removeToken(userId(req))
    res.json({ success: true, data: null })
  } catch (err) {
    next(err)
  }
}

const getSettings: Handler = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getSettings(userId(req)) })
  } catch (err) {
    next(err)
  }
}

const updateSettings: Handler = async (req, res, next) => {
  try {
    const body = pushSettingsSchema.parse(req.body)
    res.json({ success: true, data: await service.updateSettings(userId(req), body.pushEnabled) })
  } catch (err) {
    next(err)
  }
}

// Mounted at /api/v1/mobile. Guards are per route (not router-wide) so this router never touches other /mobile paths.
const guard = [authenticate, requireMobileAuth]
const router = Router()

/**
 * @swagger
 * /mobile/push-token:
 *   put:
 *     tags: [Mobile Push]
 *     summary: Register or refresh this phone's FCM device token (idempotent)
 *   delete:
 *     tags: [Mobile Push]
 *     summary: Stop pushes to this phone (token removed; logout does this automatically)
 * /mobile/push-settings:
 *   get:
 *     tags: [Mobile Push]
 *     summary: Read the push master switch
 *   patch:
 *     tags: [Mobile Push]
 *     summary: Turn all pushes on or off for this member
 */
router.put('/push-token', ...guard, registerToken)
router.delete('/push-token', ...guard, removeToken)
router.get('/push-settings', ...guard, getSettings)
router.patch('/push-settings', ...guard, updateSettings)

export default router
