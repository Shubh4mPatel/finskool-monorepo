// One-time load of the stock sheet (prisma/seed-assets/India_NSE_BSE_Equity_Stocks.xlsx) into the `stocks` table: afterwards the
// table is the sheet. Companies in the sheet are added or brought up to date (name, ISIN, BSE code and symbol, sector, industry,
// website, listing, board, series, listing date, face value); stocks that are not in the sheet are removed.
//
//   npm run db:load-stocks                      DRY RUN: says what it would do and writes nothing
//   npm run db:load-stocks -- --apply           does it, in one transaction (all or nothing)
//   npm run db:load-stocks -- --apply --reset-logos    also clears every existing logo, so db:download-stock-logos fetches them all again
//   npm run db:load-stocks -- --file=/path/to/other.xlsx
//   npm run db:load-stocks -- --apply --skip-bad-rows  go ahead although some rows of the sheet could not be read (see below)
//
// It is not "delete everything and insert": a stock that is in the sheet keeps its row, so its live-price token, its prices, its
// logo and the recommendations that refer to it stay. A stock that is not in the sheet is deleted, or only switched off when a
// stock recommendation refers to it. See prisma/stock-sheet-core.ts and docs/stock-logos.md.
//
// A row of the sheet that cannot be read (bad ISIN, no name...) is reported and left out. Because a stock missing from the
// sheet gets removed, --apply refuses to run while there are such rows, unless --skip-bad-rows says that is intended.
//
// Safe to run again: a second run finds nothing to change.
//
// Self-contained: the production image ships prisma/ and src/generated but not the rest of src/, so this reads process.env directly.
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SHEET_NAME, loadStocksFromSheet, parseStockSheet } from './stock-sheet-core.js'

const DEFAULT_FILE = fileURLToPath(new URL('./seed-assets/India_NSE_BSE_Equity_Stocks.xlsx', import.meta.url))
const tag = '[load-stocks]'
const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(`--${name}`)
const arg = (name: string): string | undefined => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

function fail(message: string): never {
  console.error(`${tag} ${message}`)
  process.exit(1)
}

const known = new Set(['--apply', '--reset-logos', '--skip-bad-rows'])
for (const a of args) if (!known.has(a) && !a.startsWith('--file=')) fail(`Unknown option ${a}. Options: --apply, --reset-logos, --skip-bad-rows, --file=<path>`)

const file = arg('file') ?? DEFAULT_FILE
const apply = flag('apply')
if (!process.env['DATABASE_URL']) fail('DATABASE_URL is not set')

function readRows(path: string): Record<string, unknown>[] {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(readFileSync(path), { type: 'buffer' })
  } catch (err) {
    return fail(`Could not read ${path}: ${err instanceof Error ? err.message : err}`)
  }
  const sheet = workbook.Sheets[SHEET_NAME]
  if (!sheet) return fail(`${path} has no sheet called "${SHEET_NAME}" (it has: ${workbook.SheetNames.join(', ')})`)
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
}

const list = (items: string[], max = 30): string => items.slice(0, max).join(', ') + (items.length > max ? `, … (+${items.length - max} more)` : '')

async function main() {
  console.log(`${tag} ${apply ? 'APPLYING' : 'DRY RUN (nothing is written; add --apply to do it)'}: ${file}`)

  let parsed: ReturnType<typeof parseStockSheet>
  try {
    parsed = parseStockSheet(readRows(file))
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  const { stocks, problems, warnings } = parsed

  const count = (listing: string) => stocks.filter(s => s.listedOn === listing).length
  console.log(`${tag} The sheet has ${stocks.length} usable stocks: ${count('nse_bse')} on NSE and BSE, ${count('nse')} NSE only, ${count('bse')} BSE only.`)
  const withSite = stocks.filter(s => s.website).length
  console.log(`${tag} ${withSite} have a website; the other ${stocks.length - withSite} can only get a logo by their ISIN.`)
  if (warnings.length > 0) {
    console.log(`${tag} ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to know:`)
    for (const w of warnings.slice(0, 20)) console.log(`${tag}   ${w}`)
    if (warnings.length > 20) console.log(`${tag}   … and ${warnings.length - 20} more`)
  }
  if (problems.length > 0) {
    console.log(`${tag} ${problems.length} row${problems.length === 1 ? '' : 's'} could not be used (their stocks are left out of the sheet, so would be removed):`)
    for (const p of problems.slice(0, 30)) console.log(`${tag}   ${p}`)
    if (problems.length > 30) console.log(`${tag}   … and ${problems.length - 30} more`)
    if (apply && !flag('skip-bad-rows')) fail('Not applying while rows are unreadable. Fix the sheet, or pass --skip-bad-rows if leaving them out is intended.')
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }) })
  try {
    const started = Date.now()
    const { plan, applied, tradesLosingStock } = await loadStocksFromSheet(prisma, stocks, {
      apply,
      resetLogos: flag('reset-logos'),
      log: line => console.log(`${tag} ${line}`),
    })

    console.log(`${tag} ${applied ? 'Done' : 'It would'}: create ${plan.create.length}, update ${plan.update.length}, already right ${plan.unchanged}, remove ${plan.remove.length}, switch off ${plan.deactivate.length}${plan.keptInactive ? ` (+${plan.keptInactive} already off)` : ''}${plan.logosCleared ? `, clear ${plan.logosCleared} logos` : ''}.`)
    if (plan.remove.length > 0) console.log(`${tag} Removed because they are not in the sheet: ${list(plan.remove.map(r => r.symbol))}`)
    if (plan.deactivate.length > 0) console.log(`${tag} Switched off, not removed, because a stock recommendation refers to them: ${list(plan.deactivate.map(r => r.symbol))}`)
    if (tradesLosingStock.length > 0) console.log(`${tag} WARNING: these are on Performance trades and are not in the sheet, so those trades lose their logo: ${list(tradesLosingStock)}`)
    if (applied) console.log(`${tag} Took ${((Date.now() - started) / 1000).toFixed(1)}s. Next: npm run db:download-stock-logos`)
    else console.log(`${tag} Nothing was written.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(`${tag} Failed:`, err instanceof Error ? err.message : err)
  process.exitCode = 1
})
