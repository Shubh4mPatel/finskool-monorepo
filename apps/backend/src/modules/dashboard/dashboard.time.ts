// The product is India-only and the server runs in UTC, so every "today" / "this month" on
// the dashboard is an IST calendar day. IST has no DST, so a fixed +05:30 offset is exact.
const IST_OFFSET_MS = 330 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')

export interface IstDate {
  year: number
  month: number // 1–12
  day: number
}

export function istNow(now: Date): IstDate {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

export const dateString = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`

export const monthString = (y: number, m: number): string => `${y}-${pad(m)}`

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function previousMonth(y: number, m: number): { year: number; month: number } {
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

/** The instant an IST calendar day begins (for timestamptz comparisons). */
export function istDayStart(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS)
}

/** Midnight UTC of a calendar date — how Prisma reads and writes `@db.Date` columns. */
export const calendarDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d))

export function addDays(date: IstDate, days: number): IstDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export const initials = (name: string): string =>
  name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
