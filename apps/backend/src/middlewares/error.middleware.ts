import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError, ValidationError } from '../shared/errors/index.js'
import { logger } from '../shared/logger.js'

/** Where the error happened, for the log: route without the query string (it can carry tokens) and who called. */
function requestContext(req: Request): { method: string; path: string; userId: string | undefined } {
  return { method: req.method, path: req.originalUrl.split('?')[0] ?? req.path, userId: req.user?.id }
}

export function errorMiddleware(
  err: unknown,
  req: Request,
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
    // 4xx are the caller's mistakes and need no log; a 5xx is the server's problem, so keep a trace of it.
    if (err.statusCode >= 500) logger.error({ ...requestContext(req), status: err.statusCode, code: err.code, message: err.message }, 'request failed')
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    })
    return
  }

  logger.error({ err, ...requestContext(req) }, 'unhandled error')
  res.status(500).json({ success: false, message: 'Internal server error' })
}
