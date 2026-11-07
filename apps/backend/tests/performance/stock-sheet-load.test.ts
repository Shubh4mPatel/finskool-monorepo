import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import {
  REQUIRED_COLUMNS,
  SHEET_NAME,
  loadStocksFromSheet,
  parseSheetDate,
  parseStockSheet,
  planLoad,
  type ExistingStock,
  type SheetStock,
} from '../../prisma/stock-sheet-core.js'
import { prisma, resetDb, createAdmin, createCommunity } from '../helpers/fixtures.js'

// The one-time load of the stock sheet (npm run db:load-stocks): the stocks table ends up matching the sheet, while a stock that is
// in the sheet keeps its row, so its live-price token, prices, logo and the recommendations that refer to it stay.

/** A row as the sheet has it (heading -> cell): numbers for BSE codes, face values and dates, as in the real file. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ISIN: 'INE144J01027',
    'Company Name': '20 Microns Limited',
    'NSE Symbol': '20MICRONS',
    'BSE Code': 533022,
    'BSE Symbol': '20MICRONS',
    'Listed On': 'NSE & BSE',
    'NSE Board': 'Main board',
    'NSE Series': 'EQ',
    Sector: 'Basic Materials',
    Industry: 'Other Industrial Metals & Mining',
    Website: 'https://www.20microns.com',
    'NSE Listing Date': 39727, // 06-Oct-2008
    'Face Value (₹)': 5,
    ...over,
  }
}

/** A BSE-only row: no NSE symbol, board, series, listing date or face value. */
const bseOnly = (isin: string, code: number, bseSymbol: string | null, over: Record<string, unknown> = {}) =>
  row({ ISIN: isin, 'Company Name': `${bseSymbol ?? code} Ltd`, 'NSE Symbol': null, 'BSE Code': code, 'BSE Symbol': bseSymbol, 'Listed On': 'BSE only', 'NSE Board': null, 'NSE Series': null, 'NSE Listing Date': null, 'Face Value (₹)': null, ...over })

/** A parsed sheet stock, for the database tests. */
const sheetStock = (over: Partial<SheetStock> = {}): SheetStock => ({
  isin: 'INE000A01001',
  name: 'Alpha Limited',
  symbol: 'ALPHA',
  exchange: 'nse',
  listedOn: 'nse_bse',
  bseCode: '500001',
  bseSymbol: 'ALPHA',
  nseBoard: 'Main board',
  nseSeries: 'EQ',
  sector: 'Industrials',
  industry: 'Machinery',
  website: 'https://www.alpha.com',
  nseListingDate: new Date('2008-10-06T00:00:00Z'),
  faceValue: '10.00',
  ...over,
})

describe('reading the sheet', () => {
  it('turns a row into a stock: text, numbers and the Excel date', () => {
    const { stocks, problems, warnings } = parseStockSheet([row()])
    expect(problems).toEqual([])
    expect(warnings).toEqual([])
    expect(stocks).toEqual([
      {
        isin: 'INE144J01027',
        name: '20 Microns Limited',
        symbol: '20MICRONS',
        exchange: 'nse',
        listedOn: 'nse_bse',
        bseCode: '533022', // a number in the sheet, text in the table
        bseSymbol: '20MICRONS',
        nseBoard: 'Main board',
        nseSeries: 'EQ',
        sector: 'Basic Materials',
        industry: 'Other Industrial Metals & Mining',
        website: 'https://www.20microns.com',
        nseListingDate: new Date('2008-10-06T00:00:00Z'),
        faceValue: '5.00',
      },
    ])
  })

  it('uses the NSE symbol, else the BSE symbol, and says which exchange the token belongs to', () => {
    const { stocks } = parseStockSheet([
      row({ ISIN: 'INE000A01001', 'NSE Symbol': 'AAA', 'BSE Symbol': 'AAABSE', 'Listed On': 'NSE & BSE' }),
      row({ ISIN: 'INE000B01009', 'NSE Symbol': 'BBB', 'BSE Code': null, 'BSE Symbol': null, 'Listed On': 'NSE only' }),
      bseOnly('INE000C01007', 500003, 'CCC'),
    ])
    expect(stocks.map(s => [s.symbol, s.exchange, s.listedOn])).toEqual([
      ['AAA', 'nse', 'nse_bse'],
      ['BBB', 'nse', 'nse'],
      ['CCC', 'bse', 'bse'],
    ])
  })

  it('gives a BSE-only company its BSE code when its BSE symbol is another company\'s NSE symbol', () => {
    const { stocks, warnings, problems } = parseStockSheet([
      row({ ISIN: 'INE0DXR01010', 'NSE Symbol': 'FOCUS', 'Company Name': 'Focus Lighting', 'BSE Symbol': 'FOCUSLTG' }),
      bseOnly('INE593W01028', 539201, 'FOCUS', { 'Company Name': 'Focus Industrial Resources' }),
    ])
    expect(problems).toEqual([])
    expect(stocks.map(s => [s.isin, s.symbol])).toEqual([
      ['INE593W01028', '539201'], // the BSE-only company gets its code (the stocks come out sorted by symbol)
      ['INE0DXR01010', 'FOCUS'], // the NSE company keeps its NSE symbol
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('BSE symbol FOCUS is used by another company')
  })

  it('gives both BSE-only companies their codes when they share a BSE symbol', () => {
    const { stocks } = parseStockSheet([bseOnly('INE000A01001', 500001, 'SAME'), bseOnly('INE000B01009', 500002, 'SAME')])
    expect(stocks.map(s => s.symbol).sort()).toEqual(['500001', '500002'])
  })

  it('leaves out a row it cannot use and says why, rather than guessing', () => {
    const { stocks, problems } = parseStockSheet([
      row({ ISIN: 'INE000A01001', 'NSE Symbol': 'GOOD' }),
      row({ ISIN: 'NOTANISIN', 'NSE Symbol': 'BADISIN' }),
      row({ ISIN: 'INE000A01001', 'NSE Symbol': 'TWICE' }),
      row({ ISIN: 'INE000C01007', 'Company Name': null, 'NSE Symbol': 'NONAME' }),
      row({ ISIN: 'INE000D01005', 'Listed On': 'MCX', 'NSE Symbol': 'ODDLISTING' }),
      row({ ISIN: 'INE000E01003', 'NSE Symbol': null }),
      row({ ISIN: 'INE000F01000', 'NSE Symbol': 'LONG', Website: `https://${'x'.repeat(300)}.com` }),
    ])
    expect(stocks.map(s => s.symbol)).toEqual(['GOOD'])
    expect(problems).toHaveLength(6)
    expect(problems.join('\n')).toMatch(/row 3: "NOTANISIN" is not an ISIN/)
    expect(problems.join('\n')).toMatch(/row 4: ISIN INE000A01001 is in the sheet twice/)
    expect(problems.join('\n')).toMatch(/row 5: INE000C01007 has no company name/)
    expect(problems.join('\n')).toMatch(/row 6: INE000D01005 has "Listed On" = "MCX"/)
    expect(problems.join('\n')).toMatch(/row 7: INE000E01003 is listed on NSE but has no NSE symbol/)
    expect(problems.join('\n')).toMatch(/row 8: INE000F01000: website is \d+ characters/)
  })

  it('refuses a sheet whose headings are not the expected ones, or that is empty', () => {
    const { Website: _dropped, ...noWebsite } = row()
    expect(() => parseStockSheet([noWebsite])).toThrow('has no column "Website"')
    expect(() => parseStockSheet([])).toThrow('no rows')
  })

  it('keeps an unreadable date or face value out of the stock without dropping the stock', () => {
    const { stocks, warnings, problems } = parseStockSheet([row({ 'NSE Listing Date': 'sometime', 'Face Value (₹)': 'ten' })])
    expect(problems).toEqual([])
    expect(stocks[0]).toMatchObject({ nseListingDate: null, faceValue: null })
    expect(warnings).toHaveLength(2)
  })

  it('reads dates from an Excel serial, a Date, "06-Oct-2008" and "2008-10-06", and nothing else', () => {
    const oct6 = new Date('2008-10-06T00:00:00Z')
    expect(parseSheetDate(39727)).toEqual(oct6)
    expect(parseSheetDate(39727.75)).toEqual(oct6)
    expect(parseSheetDate(new Date('2008-10-06T00:00:00Z'))).toEqual(oct6)
    expect(parseSheetDate('06-Oct-2008')).toEqual(oct6)
    expect(parseSheetDate('6-oct-2008')).toEqual(oct6)
    expect(parseSheetDate('2008-10-06')).toEqual(oct6)
    expect(parseSheetDate('31-Feb-2020')).toBeNull()
    expect(parseSheetDate('06-Foo-2008')).toBeNull()
    expect(parseSheetDate('yesterday')).toBeNull()
    expect(parseSheetDate(null)).toBeNull()
    expect(parseSheetDate('')).toBeNull()
    expect(parseSheetDate(-5)).toBeNull()
  })
})

describe('the committed sheet (prisma/seed-assets/India_NSE_BSE_Equity_Stocks.xlsx)', () => {
  const file = fileURLToPath(new URL('../../prisma/seed-assets/India_NSE_BSE_Equity_Stocks.xlsx', import.meta.url))
  const workbook = XLSX.read(readFileSync(file), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[SHEET_NAME]!, { defval: null, raw: true })

  it('has the headings the loader needs and every row can be used', () => {
    expect(Object.keys(rows[0]!)).toEqual([...REQUIRED_COLUMNS])
    const { stocks, problems } = parseStockSheet(rows)
    expect(problems).toEqual([])
    expect(stocks).toHaveLength(rows.length)
    // Unique by the two things the table is unique by.
    expect(new Set(stocks.map(s => s.symbol)).size).toBe(stocks.length)
    expect(new Set(stocks.map(s => s.isin)).size).toBe(stocks.length)
  })

  it('gives NSE companies their NSE symbol, so existing Performance trades and recommendations keep matching', () => {
    const { stocks } = parseStockSheet(rows)
    const tcs = stocks.find(s => s.symbol === 'TCS')!
    expect(tcs).toMatchObject({ name: 'Tata Consultancy Services Limited', exchange: 'nse', listedOn: 'nse_bse' })
    expect(tcs.isin).toMatch(/^INE/)
    expect(tcs.website).toMatch(/^https?:\/\//)
  })
})

describe('planning the load', () => {
  const existing = (over: Partial<ExistingStock> & { id: string; symbol: string }): ExistingStock => ({
    name: over.symbol,
    sector: null,
    logoUrl: null,
    token: null,
    exchange: null,
    isActive: true,
    isin: null,
    bseCode: null,
    bseSymbol: null,
    listedOn: null,
    nseBoard: null,
    nseSeries: null,
    industry: null,
    website: null,
    nseListingDate: null,
    faceValue: null,
    ...over,
  })

  it('matches an old row by symbol, then by ISIN once it has one, so a second run finds nothing to do', () => {
    const first = planLoad([existing({ id: 'a', symbol: 'ALPHA' })], new Set(), [sheetStock()])
    expect(first.update.map(u => u.id)).toEqual(['a'])
    expect(first.create).toEqual([])

    const loaded = existing({
      id: 'a', symbol: 'ALPHA', name: 'Alpha Limited', sector: 'Industrials', exchange: 'nse', isin: 'INE000A01001', bseCode: '500001', bseSymbol: 'ALPHA', listedOn: 'nse_bse',
      nseBoard: 'Main board', nseSeries: 'EQ', industry: 'Machinery', website: 'https://www.alpha.com', nseListingDate: new Date('2008-10-06T00:00:00Z'), faceValue: '10.00' as never,
    })
    const second = planLoad([loaded], new Set(), [sheetStock()])
    expect(second).toMatchObject({ create: [], update: [], unchanged: 1, remove: [], deactivate: [], conflicts: [] })
  })

  it('does not take a row that is a different company\'s (the symbol was reused) and gives the new company its own', () => {
    const plan = planLoad([existing({ id: 'old', symbol: 'ALPHA', isin: 'INE999Z01001' })], new Set(), [sheetStock()])
    expect(plan.remove.map(r => r.id)).toEqual(['old'])
    expect(plan.create.map(c => c.isin)).toEqual(['INE000A01001'])
    expect(plan.update).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('says so when a symbol would end up on two stocks', () => {
    const plan = planLoad([existing({ id: 'old', symbol: 'ALPHA', isin: 'INE999Z01001' })], new Set(['old']), [sheetStock()])
    expect(plan.deactivate.map(r => r.id)).toEqual(['old'])
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toMatch(/symbol ALPHA would be on two stocks/)
    expect(plan.conflicts[0]).toMatch(/recommendation refers to/)
  })

  it('does not change the exchange of a row whose live-price token belongs to it', () => {
    const plan = planLoad([existing({ id: 'a', symbol: 'ALPHA', token: '123', exchange: 'bse' })], new Set(), [sheetStock({ exchange: 'nse' })])
    expect(plan.update[0]!.changes.exchange).toBeUndefined()
    const noToken = planLoad([existing({ id: 'a', symbol: 'ALPHA', exchange: 'bse' })], new Set(), [sheetStock({ exchange: 'nse' })])
    expect(noToken.update[0]!.changes.exchange).toBe('nse')
  })

  it('fills a blank sector but never erases one', () => {
    const keep = planLoad([existing({ id: 'a', symbol: 'ALPHA', sector: 'Hand-picked' })], new Set(), [sheetStock({ sector: null })])
    expect(keep.update[0]!.changes.sector).toBeUndefined()
    const fill = planLoad([existing({ id: 'a', symbol: 'ALPHA' })], new Set(), [sheetStock({ sector: 'Industrials' })])
    expect(fill.update[0]!.changes.sector).toBe('Industrials')
  })
})

describe('loading the sheet into the table', () => {
  const stock = (symbol: string, over: Record<string, unknown> = {}) => prisma.stock.create({ data: { symbol, name: symbol, ...over } as never })
  const reload = (symbol: string) => prisma.stock.findUniqueOrThrow({ where: { symbol } })
  const count = () => prisma.stock.count()

  async function recommend(stockId: string) {
    const admin = await createAdmin()
    const community = await createCommunity(admin.id)
    await prisma.stockRecommendation.create({
      data: { communityId: community.id, recommendedBy: admin.id, stockId, entryPrice: 100, targetPrice: 120, stopLossPrice: 90, actionCall: 'buy', riskLevel: 'low' },
    })
  }

  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('updates a stock in place, keeping its id, live-price token, prices and logo', async () => {
    const old = await stock('ALPHA', { token: '2885', exchange: 'nse', cmp: 101.5, closePrice: 100.25, logoUrl: 'https://files.test/alpha.png', sector: null })
    const result = await loadStocksFromSheet(prisma, [sheetStock()], { apply: true })

    expect(result.applied).toBe(true)
    expect(result.plan).toMatchObject({ update: [expect.anything()], create: [], remove: [], deactivate: [] })
    const after = await reload('ALPHA')
    expect(after.id).toBe(old.id)
    expect(after).toMatchObject({
      name: 'Alpha Limited', sector: 'Industrials', industry: 'Machinery', isin: 'INE000A01001', bseCode: '500001', bseSymbol: 'ALPHA', listedOn: 'nse_bse',
      nseBoard: 'Main board', nseSeries: 'EQ', website: 'https://www.alpha.com', isActive: true,
    })
    expect(after.nseListingDate?.toISOString().slice(0, 10)).toBe('2008-10-06')
    expect(Number(after.faceValue)).toBe(10)
    // What the sheet does not have is left alone.
    expect(after.token).toBe('2885')
    expect(after.exchange).toBe('nse')
    expect(Number(after.cmp)).toBe(101.5)
    expect(Number(after.closePrice)).toBe(100.25)
    expect(after.logoUrl).toBe('https://files.test/alpha.png')
  })

  it('creates the stocks that are new', async () => {
    await loadStocksFromSheet(prisma, [sheetStock(), sheetStock({ isin: 'INE000B01009', symbol: '500002', name: 'Beta Ltd', exchange: 'bse', listedOn: 'bse', bseCode: '500002', bseSymbol: 'BETA', nseBoard: null, nseSeries: null, nseListingDate: null, faceValue: null, website: null })], { apply: true })
    expect(await count()).toBe(2)
    expect(await reload('500002')).toMatchObject({ name: 'Beta Ltd', exchange: 'bse', listedOn: 'bse', website: null, isActive: true, token: null, logoUrl: null })
  })

  it('removes stocks that are not in the sheet, and only switches off one a recommendation refers to', async () => {
    await stock('ALPHA')
    await stock('GONE')
    const referred = await stock('REFERRED')
    await recommend(referred.id)

    const result = await loadStocksFromSheet(prisma, [sheetStock()], { apply: true })

    expect(result.plan.remove.map(r => r.symbol)).toEqual(['GONE'])
    expect(result.plan.deactivate.map(r => r.symbol)).toEqual(['REFERRED'])
    expect(await prisma.stock.findUnique({ where: { symbol: 'GONE' } })).toBeNull()
    expect(await reload('REFERRED')).toMatchObject({ id: referred.id, isActive: false })
    expect(await prisma.stockRecommendation.count()).toBe(1) // nothing the recommendation needs is lost
  })

  it('writes nothing in a dry run, however much it would change', async () => {
    await stock('ALPHA')
    await stock('GONE')
    const before = await prisma.stock.findMany({ orderBy: { symbol: 'asc' } })

    const result = await loadStocksFromSheet(prisma, [sheetStock(), sheetStock({ isin: 'INE000B01009', symbol: 'BETA' })], { apply: false })

    expect(result.applied).toBe(false)
    expect(result.plan).toMatchObject({ update: [expect.anything()], create: [expect.anything()], remove: [{ symbol: 'GONE', id: expect.any(String) }] })
    expect(await prisma.stock.findMany({ orderBy: { symbol: 'asc' } })).toEqual(before)
  })

  it('finds nothing to do the second time', async () => {
    await stock('ALPHA', { token: '1' })
    await stock('GONE')
    const sheet = [sheetStock(), sheetStock({ isin: 'INE000B01009', symbol: 'BETA', name: 'Beta' })]
    await loadStocksFromSheet(prisma, sheet, { apply: true })
    const snapshot = await prisma.stock.findMany({ orderBy: { symbol: 'asc' } })

    const again = await loadStocksFromSheet(prisma, sheet, { apply: true })

    expect(again.plan).toMatchObject({ create: [], update: [], unchanged: 2, remove: [], deactivate: [], conflicts: [] })
    expect(await prisma.stock.findMany({ orderBy: { symbol: 'asc' } })).toEqual(snapshot) // not even updatedAt moved
  })

  it('clears the logos only when asked to', async () => {
    await stock('ALPHA', { logoUrl: 'https://files.test/alpha.png' })
    await loadStocksFromSheet(prisma, [sheetStock()], { apply: true })
    expect((await reload('ALPHA')).logoUrl).toBe('https://files.test/alpha.png')

    const result = await loadStocksFromSheet(prisma, [sheetStock()], { apply: true, resetLogos: true })
    expect(result.plan.logosCleared).toBe(1)
    expect((await reload('ALPHA')).logoUrl).toBeNull()
  })

  it('switches a stock back on when the sheet has it again', async () => {
    await stock('ALPHA', { isActive: false })
    await loadStocksFromSheet(prisma, [sheetStock()], { apply: true })
    expect((await reload('ALPHA')).isActive).toBe(true)
  })

  it('stops before writing anything when a symbol would end up on two stocks', async () => {
    const referred = await stock('ALPHA', { isin: 'INE999Z01001' }) // a different company on the symbol the sheet gives to INE000A01001
    await recommend(referred.id)
    await stock('GONE')

    await expect(loadStocksFromSheet(prisma, [sheetStock()], { apply: true })).rejects.toThrow(/symbol ALPHA would be on two stocks/)

    expect(await prisma.stock.findUnique({ where: { symbol: 'GONE' } })).not.toBeNull() // the delete did not happen either
    expect(await count()).toBe(2)
  })

  it('rolls everything back when the database refuses part of it', async () => {
    await stock('ALPHA')
    await stock('GONE')
    // Two sheet stocks with one ISIN: the unique index on isin rejects the second, after the delete and the update have run.
    const clash = [sheetStock(), sheetStock({ symbol: 'BETA', name: 'Beta' })]

    await expect(loadStocksFromSheet(prisma, clash, { apply: true })).rejects.toThrow()

    expect(await prisma.stock.findUnique({ where: { symbol: 'GONE' } })).not.toBeNull()
    expect((await reload('ALPHA')).isin).toBeNull()
    expect(await prisma.stock.findUnique({ where: { symbol: 'BETA' } })).toBeNull()
  })

  it('refuses an empty sheet instead of deleting every stock', async () => {
    await stock('ALPHA')
    await expect(loadStocksFromSheet(prisma, [], { apply: true })).rejects.toThrow('nothing is loaded')
    expect(await count()).toBe(1)
  })
})
