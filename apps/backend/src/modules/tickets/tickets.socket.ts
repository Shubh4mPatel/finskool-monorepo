import { z, ZodError } from 'zod'
import { logger } from '../../shared/logger.js'
import { AppError, ValidationError } from '../../shared/errors/index.js'
import type { TicketsService } from './tickets.service.js'
import { listMessagesQuerySchema, sendMessageSchema } from './tickets.validator.js'

// Member (mobile) chat over the /ws/tickets socket. Request/response is done with
// correlation ids: the client sends { id, action, payload } and gets exactly one
// { event: 'ack', id, ok, data | error } back. Live fan-out (ticket.message, ticket.updated,
// ticket.read) is unchanged and still arrives as separate frames — the sender's own sockets
// receive the ticket.message broadcast too, so clients de-duplicate by message id.

const frameSchema = z.object({
  id: z.string().trim().min(1).max(64),
  action: z.enum(['message.send', 'history.get', 'ticket.read']),
  payload: z.unknown().optional(),
})

const ticketIdSchema = z.object({ ticketId: z.string().uuid() })

export interface TicketAckError {
  code: string
  message: string
  errors?: unknown
}

export interface TicketAck {
  event: 'ack'
  id: string | null
  ok: boolean
  data?: unknown
  error?: TicketAckError
}

/** Receives one parsed inbound frame from an authenticated mobile socket; always resolves with the ack to send back. */
export type TicketSocketHandler = (userId: string, frame: unknown) => Promise<TicketAck>

function frameId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || !('id' in raw)) return null
  const id = (raw as { id: unknown }).id
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null
}

function toAckError(err: unknown): TicketAckError {
  if (err instanceof ZodError) {
    return { code: 'VALIDATION_ERROR', message: 'Validation failed', errors: err.flatten().fieldErrors }
  }
  if (err instanceof ValidationError) {
    return { code: 'VALIDATION_ERROR', message: err.message, errors: err.errors }
  }
  if (err instanceof AppError) {
    return { code: err.code ?? `HTTP_${err.statusCode}`, message: err.message }
  }
  logger.error({ err }, 'tickets socket: unhandled error')
  return { code: 'INTERNAL_ERROR', message: 'Internal server error' }
}

export function createTicketSocketHandler(service: TicketsService): TicketSocketHandler {
  return async (userId, raw) => {
    const frame = frameSchema.safeParse(raw)
    if (!frame.success) {
      return {
        event: 'ack',
        id: frameId(raw),
        ok: false,
        error: { code: 'INVALID_FRAME', message: 'Frame needs { id, action, payload } with a known action' },
      }
    }

    const { id, action, payload } = frame.data
    try {
      let data: unknown
      switch (action) {
        case 'message.send': {
          const { ticketId } = ticketIdSchema.parse(payload)
          data = await service.sendMessage(userId, ticketId, sendMessageSchema.parse(payload))
          break
        }
        case 'history.get': {
          const { ticketId } = ticketIdSchema.parse(payload)
          data = await service.listMessages(userId, ticketId, listMessagesQuerySchema.parse(payload))
          break
        }
        case 'ticket.read': {
          const { ticketId } = ticketIdSchema.parse(payload)
          data = await service.markRead(userId, ticketId)
          break
        }
      }
      return { event: 'ack', id, ok: true, data }
    } catch (err) {
      return { event: 'ack', id, ok: false, error: toAckError(err) }
    }
  }
}
