// Manual standalone entry point for the NSE + BSE bulk stock import — the
// same logic runs automatically at server boot (see src/lib/stock-import.ts,
// wired up in src/index.ts) whenever the `stocks` table is empty. Run this
// script directly only when you want to force a re-import (e.g. after
// improving the filtering heuristics in src/lib/stock-import.ts) — it always
// runs regardless of the current row count (existing symbols are still left
// untouched, since inserts use `skipDuplicates`).
//
//   npm run db:import-stocks

import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { importStocks } from '../src/lib/stock-import.js'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

importStocks(prisma)
  .then(created => console.log(`[import-stocks] Done. Inserted ${created} new stocks.`))
  .catch(e => { console.error('[import-stocks] Failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
