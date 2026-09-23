import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '../config/env.js'

// Stored as `v1:<iv>:<authTag>:<ciphertext>` (each base64). The `v1` prefix is
// the key version, so a future key rotation can tell old rows from new ones.
const VERSION = 'v1'

// Read lazily so an environment without PAN_ENCRYPTION_KEY still boots — only
// the code paths that actually touch a PAN fail there.
function getKey(): Buffer {
  const hex = env.pan.encryptionKey
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('PAN_ENCRYPTION_KEY must be 64 hex characters (32 bytes) — generate one with `openssl rand -hex 32`')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptPan(pan: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(pan, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Throws if the payload is malformed, was tampered with, or the key is wrong. */
export function decryptPan(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':')
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised PAN ciphertext format')
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
}
