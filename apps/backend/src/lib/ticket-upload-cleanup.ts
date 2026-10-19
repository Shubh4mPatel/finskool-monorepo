import type { PrismaClient } from '../generated/prisma/client.js'
import { deleteTicketObject, listTicketObjects } from './minio.js'

// A presigned upload link lives 5 minutes, so a day is far longer than any form that's still
// being filled in — anything older and unreferenced was abandoned.
const MIN_AGE_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 500

interface SweepDeps {
  list?: () => AsyncIterable<{ name: string; lastModified: Date }>
  remove?: (objectKey: string) => Promise<void>
  now?: number
}

/**
 * Deletes ticket and service uploads that no ticket / service request / message ended up referencing: files the member removed
 * from the composer before sending, or sent in a request that was then rejected. Uploads happen
 * before the ticket / message exists, so these can't be cleaned up at request time.
 */
export async function sweepOrphanTicketUploads(
  db: PrismaClient,
  { list = listTicketObjects, remove = deleteTicketObject, now = Date.now() }: SweepDeps = {},
): Promise<{ scanned: number; removed: number }> {
  let scanned = 0
  let removed = 0
  let batch: string[] = []

  const flush = async () => {
    if (batch.length === 0) return
    const [ticketFiles, serviceFiles] = await Promise.all([
      db.ticketAttachment.findMany({ where: { objectKey: { in: batch } }, select: { objectKey: true } }),
      db.serviceAttachment.findMany({ where: { objectKey: { in: batch } }, select: { objectKey: true } }),
    ])
    const usedKeys = new Set([...ticketFiles, ...serviceFiles].map(a => a.objectKey))
    const orphans = batch.filter(key => !usedKeys.has(key))
    await Promise.all(orphans.map(remove))
    removed += orphans.length
    batch = []
  }

  for await (const object of list()) {
    scanned++
    if (now - object.lastModified.getTime() < MIN_AGE_MS) continue
    batch.push(object.name)
    if (batch.length >= BATCH_SIZE) await flush()
  }
  await flush()

  return { scanned, removed }
}
