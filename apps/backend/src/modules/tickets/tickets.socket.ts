import { z, ZodError } from 'zod'
import { logger } from '../../shared/logger.js'
import { AppError, ValidationError } from '../../shared/errors/index.js'
import type { TicketsService } from './tickets.service.js'
import type { AdminActor, AdminTicketsService } from './admin-tickets.service.js'
import type { AdminServicesService } from '../services/admin-services.service.js'
import type { ServicesService } from '../services/services.service.js'
import { listMessagesQuerySchema, sendMessageSchema } from './tickets.validator.js'

// All chat traffic — sending, history, read receipts — runs over the /ws/tickets socket for both
// the mobile app (member) and the web dashboard (admin). Request/response is done with
// correlation ids: the client sends { id, action, payload } and gets exactly one
// { event: 'ack', id, ok, data | error } back. Live fan-out (ticket.message, ticket.updated,
// ticket.read) arrives as separate frames — the sender's own sockets receive the ticket.message
// broadcast too, so clients de-duplicate by message id.
//
// Who the caller is decides which service answers: a mobile session acts as the ticket owner
// (TicketsService), a web admin acts as support (AdminTicketsService, with its assignee and
// community-access rules). Everything else — creating/listing tickets, claim/resolve/reassign,
// rating, file uploads — stays on REST.
//
// Service requests (the services module) chat over this same socket with `service.*` actions,
// which take `requestId` instead of `ticketId`, so the app keeps a single connection.

const frameSchema = z.object({
  id: z.string().trim().min(1).max(64),
  action: z.enum(['message.send', 'history.get', 'ticket.read', 'service.message.send', 'service.history.get', 'service.read']),
  payload: z.unknown().optional(),
})

const ticketIdSchema = z.object({ ticketId: z.string().uuid() })
const requestIdSchema = z.object({ requestId: z.string().uuid() })

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

/** Who is on the other end of an authenticated socket, as re-verified for this request. */
export type SocketPrincipal =
  | { kind: 'member'; userId: string }
  | { kind: 'admin'; actor: AdminActor }

/** Receives one parsed inbound frame from an authenticated socket; always resolves with the ack to send back. */
export type TicketSocketHandler = (principal: SocketPrincipal, frame: unknown) => Promise<TicketAck>

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

export function createTicketSocketHandler(services: {
  member: TicketsService
  admin: AdminTicketsService
  serviceMember: ServicesService
  serviceAdmin: AdminServicesService
}): TicketSocketHandler {
  const { member, admin, serviceMember, serviceAdmin } = services

  async function handleServiceAction(
    action: 'service.message.send' | 'service.history.get' | 'service.read',
    principal: SocketPrincipal,
    payload: unknown,
  ): Promise<unknown> {
    const { requestId } = requestIdSchema.parse(payload)
    switch (action) {
      case 'service.message.send': {
        const dto = sendMessageSchema.parse(payload)
        return principal.kind === 'member'
          ? serviceMember.sendMessage(principal.userId, requestId, dto)
          : serviceAdmin.reply(principal.actor, requestId, dto)
      }
      case 'service.history.get': {
        const query = listMessagesQuerySchema.parse(payload)
        return principal.kind === 'member'
          ? serviceMember.listMessages(principal.userId, requestId, query)
          : serviceAdmin.listMessages(requestId, query)
      }
      case 'service.read':
        return principal.kind === 'member'
          ? serviceMember.markRead(principal.userId, requestId)
          : serviceAdmin.markRead(principal.actor, requestId)
    }
  }

  return async (principal, raw) => {
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
      if (action === 'service.message.send' || action === 'service.history.get' || action === 'service.read') {
        const data = await handleServiceAction(action, principal, payload)
        return { event: 'ack', id, ok: true, data }
      }

      const { ticketId } = ticketIdSchema.parse(payload)
      let data: unknown
      switch (action) {
        case 'message.send': {
          const dto = sendMessageSchema.parse(payload)
          data =
            principal.kind === 'member'
              ? await member.sendMessage(principal.userId, ticketId, dto)
              : await admin.reply(principal.actor, ticketId, dto)
          break
        }
        case 'history.get': {
          const query = listMessagesQuerySchema.parse(payload)
          data =
            principal.kind === 'member'
              ? await member.listMessages(principal.userId, ticketId, query)
              : await admin.listMessages(principal.actor, ticketId, query)
          break
        }
        case 'ticket.read': {
          data =
            principal.kind === 'member'
              ? await member.markRead(principal.userId, ticketId)
              : await admin.markRead(principal.actor, ticketId)
          break
        }
      }
      return { event: 'ack', id, ok: true, data }
    } catch (err) {
      return { event: 'ack', id, ok: false, error: toAckError(err) }
    }
  }
}
