import { createRequire } from 'node:module'
import type { TransactionDTO } from './transactions.service.js'

const _require = createRequire(import.meta.url)
interface Cell {
  t: 's' | 'n'
  v: string | number
  z?: string
}
const XLSX = _require('xlsx') as {
  utils: {
    book_new(): unknown
    aoa_to_sheet(rows: (Cell | null)[][]): Record<string, unknown>
    book_append_sheet(wb: unknown, ws: unknown, name: string): void
  }
  write(wb: unknown, opts: { type: 'buffer'; bookType: 'xlsx' }): Buffer
}

const IST_OFFSET_MS = 330 * 60 * 1000
const EXCEL_EPOCH_DAYS = 25569 // days from 1899-12-30 to 1970-01-01

/** An Excel date-time that reads as the IST wall-clock time (Excel dates carry no zone). */
const istSerial = (iso: string): number => (new Date(iso).getTime() + IST_OFFSET_MS) / 86_400_000 + EXCEL_EPOCH_DAYS

const STATUS_LABEL = { paid: 'Paid', failed: 'Failed', flagged: 'Flagged' } as const

const text = (v: string | null | undefined): Cell => ({ t: 's', v: v ?? '' })

const COLUMNS: { header: string; width: number }[] = [
  { header: 'Date (IST)', width: 18 },
  { header: 'Invoice', width: 22 },
  { header: 'Payment ID', width: 26 },
  { header: 'Order ID', width: 26 },
  { header: 'Member', width: 24 },
  { header: 'Email', width: 28 },
  { header: 'Type', width: 12 },
  { header: 'Paid for', width: 28 },
  { header: 'Plan / Request', width: 22 },
  { header: 'Amount (INR)', width: 14 },
  { header: 'Status', width: 10 },
  { header: 'Method', width: 10 },
  { header: 'Reason', width: 44 },
]

/**
 * The transactions as an .xlsx file. Amounts are numbers and dates are real dates, so the admin can sum, sort and filter
 * in Excel. Text is stored as text cells, which Excel never runs as a formula, so a member's name needs no escaping.
 */
export function transactionsToXlsx(items: TransactionDTO[]): Buffer {
  const rows: (Cell | null)[][] = [
    COLUMNS.map(c => text(c.header)),
    ...items.map(t => [
      { t: 'n' as const, v: istSerial(t.occurredAt), z: 'dd-mmm-yyyy hh:mm' },
      text(t.invoice?.number),
      text(t.paymentId),
      text(t.orderId),
      text(t.member.name),
      text(t.member.email),
      text(t.kind === 'community' ? 'Community' : 'Service'),
      text(t.paidFor.name),
      text(t.kind === 'community' ? t.planName : t.reference),
      { t: 'n' as const, v: t.amount, z: '#,##0.00' },
      text(STATUS_LABEL[t.status]),
      text(t.method),
      text(t.reason),
    ]),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = COLUMNS.map(c => ({ wch: c.width }))
  sheet['!autofilter'] = { ref: `A1:${String.fromCharCode(64 + COLUMNS.length)}${rows.length}` }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Transactions')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
