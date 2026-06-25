import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { logger } from '../shared/logger.js'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const adapter = new PrismaPg({ connectionString })

const prisma = new PrismaClient({
  adapter,
  log: process.env['NODE_ENV'] === 'development' ? ['query', 'error'] : ['error'],
})

prisma.$on('error' as never, (e: { message: string }) => {
  logger.error({ message: e.message }, 'prisma error')
})

export default prisma
