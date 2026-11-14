import { createRequire } from 'node:module'
import type { MemberDisplayStatus, MemberItemDTO, MemberSubscriptionDTO } from './admin.dto.js'

const _require = createRequire(import.meta.url)
interface Cell {
  t: 's' | 'n'
  v: string | number
  z?: string
}
const XLSX = _require('xlsx') as {
  utils: {
    book_new(): unknown
    aoa_to_sheet(rows: Cell[][]): Record<string, unknown>
    book_append_sheet(wb: unknown, ws: unknown, name: string): void
  }
  write(wb: unknown, opts: { type: 'buffer'; bookType: 'xlsx' }): Buffer
}

const STATUS_LABEL: Record<MemberDisplayStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  suspended: 'Suspended',
  deleted: 'Deleted',
}

// The first seven are Import CSV's own columns, in its order, so an exported file can be imported again (the importers
// read .xlsx as well and ignore the rest). Status ... Reason are extra.
const COLUMNS: { header: string; width: number }[] = [
  { header: 'Name', width: 26 },
  { header: 'Contact Number', width: 16 },
  { header: 'Payment', width: 12 },
  { header: 'Paid on', width: 12 },
  { header: 'Valid', width: 12 },
  { header: 'Service', width: 26 },
  { header: 'Email', width: 30 },
  { header: 'Status', width: 12 },
  { header: 'Added On', width: 12 },
  { header: 'Suspended in', width: 26 },
  { header: 'Suspension reason', width: 40 },
]

// Text cells are never run as a formula by Excel, so a name or e-mail needs no escaping. Phones stay text (a leading +),
// and the dates are YYYY-MM-DD text: that is the one date format the importer accepts, and it also sorts correctly.
const text = (v: string | null | undefined): Cell => ({ t: 's', v: v ?? '' })

/** Where the member is suspended on this row: the whole account, or the one community whose block this row is. */
function suspendedIn(m: MemberItemDTO, sub: MemberSubscriptionDTO | null): { where: string; reason: string } {
  if (m.accountStatus === 'suspended') return { where: 'Entire account', reason: m.suspensionReason ?? '' }
  if (sub?.block) return { where: sub.communityName, reason: sub.block.reason }
  return { where: '', reason: '' }
}

/**
 * The members as an .xlsx file, one row per subscription (a member with none is one row with blank cells). Payment is a
 * number, so the admin can sum and filter it. Members suspended from a community list that community's row first.
 */
export function membersToXlsx(members: MemberItemDTO[]): Buffer {
  const rows: Cell[][] = [
    COLUMNS.map(c => text(c.header)),
    ...members
      .flatMap(m => (m.allSubscriptions.length > 0 ? m.allSubscriptions.map(sub => ({ m, sub })) : [{ m, sub: null as MemberSubscriptionDTO | null }]))
      .map(({ m, sub }) => {
        const susp = suspendedIn(m, sub)
        return [
          text(m.name),
          text(m.phone),
          sub ? { t: 'n' as const, v: sub.payment } : text(''),
          text(sub?.paidOn),
          text(sub?.validUntil),
          text(sub?.communityName),
          text(m.email),
          text(STATUS_LABEL[m.status]),
          text(m.createdAt.slice(0, 10)),
          text(susp.where),
          text(susp.reason),
        ]
      }),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = COLUMNS.map(c => ({ wch: c.width }))
  sheet['!autofilter'] = { ref: `A1:${String.fromCharCode(64 + COLUMNS.length)}${rows.length}` }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Members')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
