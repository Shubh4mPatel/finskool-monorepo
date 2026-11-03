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

  // A database error that got past validation is still the caller's input, not a server fault: answer with a clean
  // 4xx instead of a 500 (the real error is logged). Unique keys are a conflict, malformed / too long / out of
  // range values are a bad request.
  const db = err as { code?: string; name?: string } | null
  if (db && typeof db === 'object' && db.name === 'PrismaClientKnownRequestError') {
    if (db.code === 'P2002') {
      logger.warn({ err, ...requestContext(req) }, 'unique key conflict')
      res.status(409).json({ success: false, message: 'That value is already in use', code: 'CONFLICT' })
      return
    }
    if (db.code === 'P2000' || db.code === 'P2007' || db.code === 'P2020') {
      logger.warn({ err, ...requestContext(req) }, 'database refused an input value')
      res.status(400).json({ success: false, message: 'One of the values you sent is not valid', code: 'INVALID_VALUE' })
      return
    }
  }

  // Upload errors from multer (file too big, too many files)
  const upload = err as { name?: string; code?: string } | null
  if (upload && typeof upload === 'object' && upload.name === 'MulterError') {
    const tooBig = upload.code === 'LIMIT_FILE_SIZE'
    res.status(tooBig ? 413 : 400).json({ success: false, message: tooBig ? 'That file is too large' : 'The upload was not accepted', code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID' })
    return
  }

  // The body parser's own errors (malformed JSON, body too large) are the caller's mistake, not a server fault.
  const parsed = err as { type?: string; status?: number } | null
  if (parsed && typeof parsed === 'object' && parsed.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'Request body is not valid JSON', code: 'INVALID_JSON' })
    return
  }
  if (parsed && typeof parsed === 'object' && parsed.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Request body is too large', code: 'BODY_TOO_LARGE' })
    return
  }

  logger.error({ err, ...requestContext(req) }, 'unhandled error')
  res.status(500).json({ success: false, message: 'Internal server error' })
}
