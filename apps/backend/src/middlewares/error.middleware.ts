import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError, ValidationError } from '../shared/errors/index.js'
import { logger } from '../shared/logger.js'

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: err.flatten().fieldErrors,
    })
    return
  }

  if (err instanceof ValidationError) {
    res.status(422).json({
      success: false,
      message: err.message,
      errors: err.errors,
    })
    return
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    })
    return
  }

  logger.error({ err }, 'unhandled error')
  res.status(500).json({ success: false, message: 'Internal server error' })
}
