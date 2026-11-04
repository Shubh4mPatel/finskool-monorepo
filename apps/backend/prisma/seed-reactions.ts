import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { syncReactionTypes, REACTION_TYPES } from './reaction-types.js'

// Re-applies the reaction types by hand: `npm run db:seed:reactions`. A normal deploy needs nothing from you, because
// the migration 20261105100000_reaction_types_v2 does the same on `prisma migrate deploy`. Idempotent.

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  const result = await syncReactionTypes(prisma)
  console.log(`[seed-reactions] types: ${REACTION_TYPES.map(t => `${t.emoji} ${t.name}`).join(', ')}`)
  console.log(`[seed-reactions] removed types: ${result.removedTypes.join(', ') || 'none'}; reactions deleted with them: ${result.removedReactions}`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
