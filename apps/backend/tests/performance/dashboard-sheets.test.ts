import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import * as XLSX from 'xlsx'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// The community dashboards are Google Sheets exports: a title block above the headers (headers on row 6), a summary
// block beside the table, text and real dates mixed in one column, targets stored as percentages (5% is 0.05), "Open"
// in the Exit Date column while a trade runs, and one tab per segment in the investor workbook. These tests build
// workbooks with that shape, read them with the admin web app's own parser, and push the rows through the real import.

type Parse = (file: File, kind: string, segment?: string) => Promise<{
  rows: Record<string, unknown>[]
  missing: string[]
  sheetName: string
  headerRow: number
}>
// The parser lives in the web app. It is loaded by path so this package's type-check does not have to compile it.
const parserPath = '../../../frontend/src/lib/performance.ts'
const { parseSheet } = (await import(/* @vite-ignore */ parserPath)) as { parseSheet: Parse }

const app = createApp()
let boss: TestAdmin
const boards: Record<string, string> = {}

const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 0, 0, 0))

/** A sheet with `title` rows above the header, then the table, then an optional summary block beside it. */
function dashboardSheet(opts: { header: string[]; rows: unknown[][]; summary?: [number, string, unknown][]; summaryCol?: number }): XLSX.WorkSheet {
  const grid: unknown[][] = [['Community Dashboard'], [], [], [], [], opts.header, ...opts.rows]
  const sheet = XLSX.utils.aoa_to_sheet(grid, { cellDates: true })
  for (const [row, label, value] of opts.summary ?? []) {
    const col = opts.summaryCol ?? opts.header.length + 1
    sheet[XLSX.utils.encode_cell({ r: row, c: col })] = { t: 's', v: label }
    sheet[XLSX.utils.encode_cell({ r: row, c: col + 1 })] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) }
  }
  const range = XLSX.utils.decode_range(sheet['!ref']!)
  range.e.c = Math.max(range.e.c, (opts.summaryCol ?? opts.header.length + 1) + 1)
  sheet['!ref'] = XLSX.utils.encode_range(range)
  return sheet
}

function xlsxFile(name: string, tabs: [string, XLSX.WorkSheet, { hidden?: boolean }?][]): File {
  const wb = XLSX.utils.book_new()
  for (const [tab, sheet] of tabs) XLSX.utils.book_append_sheet(wb, sheet, tab)
  wb.Workbook = { Sheets: tabs.map(([tab, , o]) => ({ name: tab, Hidden: o?.hidden ? 1 : 0 })) }
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], name)
}

const intradayFile = () =>
  xlsxFile('Intraday_Dashboard.xlsx', [
    [
      'Intraday',
      dashboardSheet({
        header: ['S.N.', 'Date', 'Stock', 'Type', 'Entry', 'Exit', 'P/L', 'P/L % ', 'P&L', 'Charges', 'Net P&L'],
        rows: [
          [1, date(2026, 8, 24), 'Muthoot Finance', 'Buy', 3158.68, 3176, 17.32, 0.027, 1369, -140, 1229],
          [2, date(2026, 8, 25), 'Paradeep Phosphate', 'Sell', 156.88, 158.17, -1.29, -0.041, -2056, -140, -2196],
          [3],
          [4, '26 Aug 2026', 'Hindustan Zinc', 'Buy', 620.18, 621.8, 1.62, 0.013, 1306, -140, 1166],
        ],
        summary: [
          [7, 'Capital Deployed', 50000],
          [8, 'Gross P/L', 2743.87],
        ],
        summaryCol: 12,
      }),
    ],
    ['Sheet2', XLSX.utils.aoa_to_sheet([['Stock', 'Position'], ['Muthoot Finance', 'Long']]), { hidden: true }],
  ])

const alphaFile = () =>
  xlsxFile('Alpha_Dashboard.xlsx', [
    [
      'Alpha',
      dashboardSheet({
        header: ['Month', 'S. N.', 'Date', 'Trade Name', 'NSE Code', 'Entry', 'CMP', 'Returns', 'Target', 'Target Price', 'Analysis', 'Exit Date', ' Holding Days'],
        rows: [
          [date(2025, 10, 1), 1, date(2025, 10, 7), 'India Nippon', 'INDNIPPON', 1076, 1185.5, 'Target Met', 0.05, 1129.8, '5% booked', date(2026, 7, 9), 275],
          [null, 2, date(2025, 10, 8), 'National Aluminium', 'NATIONALUM', 224, 317.55, 'Target Met', 0.05, 235.2, '5% booked', date(2025, 10, 24), 16],
          [date(2025, 11, 1), 3, date(2025, 11, 28), 'Emami', 'EMAMILTD', 530, 382, -0.279, 0.05, 556.5, 'Hold', 'Open', ''],
          [null, 4, date(2025, 12, 2), 'Kotak Bank', 'KOTAKBANK', 459, 464.65, 0.0123, 0.05, 481.95, 'Can Add at CMP', 'Open', ''],
        ],
        summary: [[8, 'Trades Given', 44]],
        summaryCol: 14,
      }),
    ],
  ])

const investorFile = () =>
  xlsxFile('Investor_Dashboard.xlsx', [
    [
      'Investor',
      dashboardSheet({
        header: ['Month', 'S. N.', 'Date', 'Trade Name', 'NSE Code', 'Entry', 'CMP', 'Returns', 'Target', 'Target Price', 'Analysis', 'Exit Date', ' Holding Days'],
        rows: [
          [date(2025, 1, 1), 1, date(2025, 1, 15), 'NTPC', 'NTPC', 402, 321.55, -0.2, 0.3, 522.6, 'Can Add at CMP', 'Open', ''],
          [null, 2, date(2025, 1, 20), 'Waaree Renewable', 'WAAREERTL', 1080, 697.3, 'Target Met', 0.2, 1296, '30% Booked', date(2025, 10, 27), 280],
        ],
        summary: [[8, 'Trades Given', 6]],
        summaryCol: 14,
      }),
    ],
    [
      'Long Term ',
      dashboardSheet({
        header: ['S. N.', 'Theme / Sector / Type', 'Date', 'Company Name ', 'NSE Code', 'Entry', 'CMP', 'Returns', 'Analysis'],
        rows: [
          [1, 'Ports Monopoly', date(2023, 3, 9), 'Adani Ports & SEZ', 'ADANIPORTS', 714, 1866.9, 1.6, 'Hold'],
          [2, 'Data Centre', '11 Sept 2024', 'Anant Raj ', 'ANANTRAJ', 607, 443.9, -0.27, 'Hold'],
        ],
      }),
    ],
    [
      'US Investment',
      dashboardSheet({
        header: ['S. N.', 'Theme', 'Date', 'Company Name ', 'Code', 'Entry', 'CMP', 'Returns', 'Analysis'],
        rows: [[1, 'Longevity ', date(2026, 6, 5), 'Eli Lily and Company', 'LLY', 1147, 1410.99, 0.23, 'Can Add at CMP'], [2]],
      }),
    ],
  ])

async function boardFor(kind: 'intraday' | 'swing' | 'investor') {
  if (!boards[kind]) {
    const community = await createCommunity(boss.id, { name: `${kind} community` })
    await prisma.performanceBoard.create({ data: { communityId: community.id, kind } })
    boards[kind] = community.id
  }
  return boards[kind]!
}
const importRows = async (kind: 'intraday' | 'swing' | 'investor', segment: string, rows: unknown[], dryRun = false) =>
  request(app)
    .post(`/api/v1/admin/performance/communities/${await boardFor(kind)}/import`)
    .set('Authorization', boss.auth)
    .send({ segment, rows, dryRun })

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  for (const k of Object.keys(boards)) delete boards[k]
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('reading a dashboard workbook', () => {
  it('finds the header row below the title block and ignores the summary block and the hidden tab', async () => {
    const sheet = await parseSheet(intradayFile(), 'intraday')
    expect(sheet).toMatchObject({ missing: [], sheetName: 'Intraday', headerRow: 6 })
    expect(sheet.rows.map(r => r['name'])).toEqual(['Muthoot Finance', 'Paradeep Phosphate', 'Hindustan Zinc'])
    // The row numbers are the sheet's own (the blank-ish row 9 holds only a serial number and is skipped).
    expect(sheet.rows.map(r => r['row'])).toEqual([7, 8, 10])
  })

  it('reads real dates and text dates ("26 Aug 2026", "11 Sept 2024") as the same YYYY-MM-DD', async () => {
    const intraday = await parseSheet(intradayFile(), 'intraday')
    expect(intraday.rows.map(r => r['tradeDate'])).toEqual(['2026-08-24', '2026-08-25', '2026-08-26'])
    const longTerm = await parseSheet(investorFile(), 'investor', 'long_term')
    expect(longTerm.rows.map(r => r['tradeDate'])).toEqual(['2023-03-09', '2024-09-11'])
  })

  it('turns a percentage-formatted Target (0.05, 0.3) into 5 and 30', async () => {
    const alpha = await parseSheet(alphaFile(), 'swing')
    expect(alpha.rows.map(r => r['targetPct'])).toEqual([5, 5, 5, 5])
    const investor = await parseSheet(investorFile(), 'investor', 'investor')
    expect(investor.rows.map(r => r['targetPct'])).toEqual([30, 20])
  })

  it('leaves a target that is already in percent alone (5, 10)', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Date', 'Trade Name', 'NSE Code', 'Entry', 'Target'], ['2026-08-12', 'Skipper', 'SKIPPER', 543, 10], ['2026-08-13', 'BLS', 'BLS', 262, 5]])
    const file = xlsxFile('x.xlsx', [['Swing', sheet]])
    expect((await parseSheet(file, 'swing')).rows.map(r => r['targetPct'])).toEqual([10, 5])
  })

  it('treats "Open" and "Hold" in Exit Date as no exit date, and keeps real exit dates', async () => {
    const alpha = await parseSheet(alphaFile(), 'swing')
    expect(alpha.rows.map(r => r['exitDate'])).toEqual(['2026-07-09', '2025-10-24', undefined, undefined])
  })

  it('reads the tab that belongs to the segment being uploaded', async () => {
    const file = investorFile()
    expect((await parseSheet(file, 'investor', 'investor')).sheetName).toBe('Investor')
    expect((await parseSheet(file, 'investor', 'long_term')).sheetName).toBe('Long Term ')
    const us = await parseSheet(file, 'investor', 'us_investment')
    expect(us.sheetName).toBe('US Investment')
    expect(us.rows).toHaveLength(1) // the second row holds only a serial number
    expect(us.rows[0]).toMatchObject({ symbol: 'LLY', name: 'Eli Lily and Company', entryPrice: 1147 })
  })

  it('still reads a plain sheet whose header is on row 1', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Date', 'Stock', 'Type', 'Entry', 'Exit'], ['2026-10-01', 'Ambuja Cement', 'Buy', '368.20', '365.70']])
    const parsed = await parseSheet(xlsxFile('x.xlsx', [['Sheet1', sheet]]), 'intraday')
    expect(parsed).toMatchObject({ missing: [], headerRow: 1 })
    expect(parsed.rows[0]).toMatchObject({ row: 2, name: 'Ambuja Cement', side: 'Buy' })
  })

  it('names the missing columns when no header row can be found', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Some title'], ['nothing useful', 'here']])
    const parsed = await parseSheet(xlsxFile('x.xlsx', [['Sheet1', sheet]]), 'swing')
    expect(parsed.missing).toEqual(['Date', 'Trade Name', 'NSE Code', 'Entry'])
  })

  it('keeps real row numbers when the sheet has blank rows in the middle', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Date', 'Stock', 'Type', 'Entry', 'Exit'], ['2026-10-01', 'A Co', 'Buy', 10, 11], [], [], ['bad date', 'B Co', 'Buy', 10, 11]])
    const parsed = await parseSheet(xlsxFile('x.xlsx', [['Sheet1', sheet]]), 'intraday')
    expect(parsed.rows.map(r => r['row'])).toEqual([2, 5])
    const res = await importRows('intraday', 'main', parsed.rows)
    expect(res.body.data.errors).toEqual([expect.objectContaining({ row: 5, ref: 'B Co' })])
  })
})

describe('importing the dashboards', () => {
  it('imports an intraday dashboard and reports the same numbers the system computes from it', async () => {
    const parsed = await parseSheet(intradayFile(), 'intraday')
    const res = await importRows('intraday', 'main', parsed.rows)
    expect(res.body.data).toMatchObject({ created: 3, updated: 0, errors: [] })
    const overview = await request(app).get(`/api/v1/admin/performance/communities/${boards['intraday']}/overview`).set('Authorization', boss.auth)
    // Buy 3158.68 -> 3176 and Buy 620.18 -> 621.8 gain; Sell 156.88 -> 158.17 loses (a short covered higher).
    expect(overview.body.data.summary).toMatchObject({ totalTrades: 3, profitMakingTrades: 2, lossMakingTrades: 1, totalCharges: 420 })
  })

  it('imports every swing row, open trades included, with percent targets', async () => {
    const parsed = await parseSheet(alphaFile(), 'swing')
    const res = await importRows('swing', 'main', parsed.rows)
    expect(res.body.data).toMatchObject({ created: 4, errors: [] })
    const stored = await prisma.performanceTrade.findMany({ orderBy: { tradeDate: 'asc' } })
    expect(stored.map(t => Number(t.targetPct))).toEqual([5, 5, 5, 5])
    expect(stored.map(t => t.exitDate === null)).toEqual([false, false, true, true])
  })

  it('imports the three investor tabs into their own segments', async () => {
    const file = investorFile()
    for (const [segment, expected] of [['investor', 2], ['long_term', 2], ['us_investment', 1]] as const) {
      const parsed = await parseSheet(file, 'investor', segment)
      const res = await importRows('investor', segment, parsed.rows)
      expect(res.body.data, segment).toMatchObject({ created: expected, errors: [] })
    }
    expect(await prisma.performanceTrade.count({ where: { segment: 'long_term' } })).toBe(2)
    expect(await prisma.performanceTrade.count({ where: { segment: 'us_investment' } })).toBe(1)
  })

  it('uploading the same dashboard again changes nothing', async () => {
    const parsed = await parseSheet(alphaFile(), 'swing')
    await importRows('swing', 'main', parsed.rows)
    const again = await importRows('swing', 'main', parsed.rows)
    expect(again.body.data).toMatchObject({ created: 0, updated: 0, unchanged: 4, errors: [] })
  })

  it('a trade that closes in a later upload gets its exit date', async () => {
    const first = await parseSheet(alphaFile(), 'swing')
    await importRows('swing', 'main', first.rows)
    const rows = first.rows.map(r => (r['symbol'] === 'EMAMILTD' ? { ...r, exitDate: '2026-02-10' } : r))
    const second = await importRows('swing', 'main', rows)
    expect(second.body.data).toMatchObject({ created: 0, updated: 1, unchanged: 3 })
    expect(Number((await prisma.performanceTrade.findFirstOrThrow({ where: { symbol: 'EMAMILTD' } })).exitDate?.toISOString().slice(0, 10) === '2026-02-10')).toBe(1)
  })

  it('the hit-rate card of a period matches what the sheet says (trades given and met)', async () => {
    const parsed = await parseSheet(alphaFile(), 'swing')
    await importRows('swing', 'main', parsed.rows)
    const created = await request(app)
      .post(`/api/v1/admin/performance/communities/${boards['swing']}/periods`)
      .set('Authorization', boss.auth)
      .send({ segment: 'main', fromMonth: '2025-10', toMonth: '2025-12' })
    expect(created.status).toBe(201)
    const overview = await request(app).get(`/api/v1/admin/performance/communities/${boards['swing']}/overview`).set('Authorization', boss.auth)
    expect(overview.body.data.summary.periods[0]).toMatchObject({ label: 'Oct25 to Dec25', given: 4, met: 2, metPct: 50 })
  })

  it('accepts an exit date of "Open" sent straight to the API, as a trade that is still running', async () => {
    const res = await importRows('swing', 'main', [{ row: 2, tradeDate: '2026-10-30', name: 'Kotak Bank', symbol: 'KOTAKBANK', entryPrice: 459, exitDate: 'Open' }])
    expect(res.body.data).toMatchObject({ created: 1, errors: [] })
  })
})
