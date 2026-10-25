import { vi } from 'vitest'

// BullMQ: a real Queue opens a Redis connection as soon as it's constructed
// (src/lib/queue.ts does that at import time). Each instance gets its own
// `add` spy instead, so tests can assert on exactly which email jobs a request
// enqueued via `vi.mocked(notificationsQueue.add)`.
vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn().mockResolvedValue({ id: 'job' })
    upsertJobScheduler = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    on = vi.fn()
  }
  class Worker {
    on = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
  }
  return { Queue, Worker }
})

// Redis: keep the real key helpers, swap the client for an object whose every
// command is a spy resolving to null (a cache miss / no-op publish). `then` is
// excluded so the client is never mistaken for a Promise.
vi.mock('../../src/lib/redis.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/redis.js')>()
  const commands: Record<string | symbol, unknown> = {}
  const client = new Proxy(commands, {
    get: (target, prop) => {
      if (prop === 'then') return undefined
      target[prop] ??= vi.fn().mockResolvedValue(null)
      return target[prop]
    },
  })
  return { ...actual, default: client }
})

vi.mock('../../src/shared/logger.js', () => {
  const noop = () => undefined
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger }
  return { logger }
})
