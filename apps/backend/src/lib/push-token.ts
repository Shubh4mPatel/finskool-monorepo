import { Prisma } from '../generated/prisma/client.js'

/**
 * Makes every transaction that writes the same phone token take turns. Without it, two members registering the
 * same token at the same moment each clear the other's row and then set their own, and the database either
 * deadlocks them or lets both keep it. Call it first inside the transaction; the lock is released at commit.
 */
export async function lockPushToken(tx: Prisma.TransactionClient, token: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${token}))`
}

/** Deadlocks and write conflicts reach us as a driver error (not a Prisma known error), so check both shapes. */
function isTokenCollision(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === 'P2002' || err.code === 'P2034'
  const message = err instanceof Error ? err.message : ''
  return /deadlock detected|could not serialize access|write conflict/i.test(message)
}

/**
 * Runs a token write, retrying if it still collides with a concurrent one (unique rule, deadlock or write
 * conflict). The retry simply takes the token from whoever got it first, so the last caller wins and exactly
 * one member ends up holding it.
 */
export async function withTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTokenCollision(err) || attempt >= 4) throw err
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40 * (attempt + 1)))
    }
  }
}
