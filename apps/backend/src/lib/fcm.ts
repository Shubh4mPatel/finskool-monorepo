import { readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import type { App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import type { Message } from 'firebase-admin/messaging'
import { env } from '../config/env.js'
import { logger } from '../shared/logger.js'

export interface PushMessage {
  token: string
  title: string
  body: string
  // FCM data values must be strings.
  data: Record<string, string>
  // Groups banners of one conversation together on iPhone (each message still gets its own banner).
  threadId?: string | undefined
}

export type PushOutcome =
  | { ok: true }
  // The token will never work again: clear it, do not retry.
  | { ok: false; kind: 'invalid-token'; code: string }
  // Temporary (Firebase unavailable, rate limited, ...): retry later.
  | { ok: false; kind: 'transient'; code: string }
  // Anything else (bad credentials, malformed payload): retrying will not help, but the token may still be fine.
  | { ok: false; kind: 'failed'; code: string }

// FCM accepts at most 500 messages per sendEach call.
export const FCM_BATCH_SIZE = 500

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])
const TRANSIENT_CODES = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
  'messaging/unknown-error',
])

export function classifyFcmError(code: string): PushOutcome {
  if (INVALID_TOKEN_CODES.has(code)) return { ok: false, kind: 'invalid-token', code }
  if (TRANSIENT_CODES.has(code)) return { ok: false, kind: 'transient', code }
  return { ok: false, kind: 'failed', code }
}

function credentialJson(): string {
  if (env.fcm.serviceAccountJson) return env.fcm.serviceAccountJson
  if (env.fcm.serviceAccountFile) return readFileSync(env.fcm.serviceAccountFile, 'utf8')
  return ''
}

let app: App | null | undefined

function firebaseApp(): App | null {
  if (app !== undefined) return app
  const json = credentialJson()
  if (!json) {
    app = null
    return app
  }
  try {
    app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(json)) })
  } catch (err) {
    logger.error({ err }, 'fcm: invalid service account credentials; push sending disabled')
    app = null
  }
  return app
}

/** False when no credentials are configured, in which case pushes are skipped (and logged) rather than failing. */
export function isPushConfigured(): boolean {
  return Boolean(env.fcm.fakeUrl) || firebaseApp() !== null
}

function toFirebaseMessage(m: PushMessage): Message {
  return {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: m.data,
    android: {
      priority: 'high',
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default', ...(m.threadId ? { 'thread-id': m.threadId } : {}) } },
    },
  }
}

/** Sends up to FCM_BATCH_SIZE messages and returns one outcome per message, in order. Never throws for per-token errors. */
export async function sendPushBatch(messages: PushMessage[]): Promise<PushOutcome[]> {
  if (messages.length === 0) return []

  if (env.fcm.fakeUrl) {
    const res = await fetch(env.fcm.fakeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) throw new Error(`fake FCM responded ${res.status}`)
    const body = (await res.json()) as { responses: { success: boolean; error?: { code: string } }[] }
    return body.responses.map(r => (r.success ? { ok: true } : classifyFcmError(r.error?.code ?? 'messaging/unknown-error')))
  }

  const fb = firebaseApp()
  if (!fb) throw new Error('FCM is not configured')
  const result = await getMessaging(fb).sendEach(messages.map(toFirebaseMessage))
  return result.responses.map(r => (r.success ? { ok: true } : classifyFcmError(r.error?.code ?? 'messaging/unknown-error')))
}
