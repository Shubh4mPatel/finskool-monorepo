import { z } from 'zod'

export const MAX_IMPORT_ROWS = 2000

export const PERFORMANCE_KINDS = ['intraday', 'swing', 'investor'] as const
export const PERFORMANCE_SEGMENTS = ['main', 'investor', 'long_term', 'us_investment'] as const
export const TRADE_VISIBILITIES = ['auto', 'show', 'hide'] as const

// Limits mirror the column sizes: Decimal(12,2) prices, Decimal(5,2) percentages, Decimal(14,2) capital.
const MAX_PRICE = 9_999_999_999
const MAX_PCT = 999.99
const MAX_CAPITAL = 999_999_999_999

// ─── Field builders ─────────────────────────────────────────────────────────
// A sheet hands over strings ("1,234.50", "₹ 99", "5%", ""), so a blank cell is "not given" and a numeric string is a
// number. `null` is kept: on a PATCH it means "clear this field".

const blankToUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v)

/** What an Exit Date cell holds while a trade is still running ("Open", "Hold", "-"): the same as leaving it empty. */
const NO_EXIT_YET = new Set(['open', 'hold', 'holding', 'running', 'pending', 'na', 'n/a', 'nil', 'none', '-', '–', '—'])
const exitDateInput = (v: unknown): unknown =>
  typeof v === 'string' && (v.trim() === '' || NO_EXIT_YET.has(v.trim().toLowerCase())) ? undefined : v

function toNumber(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const cleaned = v.replace(/[,\s₹$%]/g, '')
  return cleaned === '' ? undefined : Number(cleaned)
}

const number = (label: string) =>
  z.number({ error: iss => (iss.input === undefined ? `${label} is required` : `${label} must be a number`) })

const price = (label: string) =>
  number(label).positive(`${label} must be greater than 0`).max(MAX_PRICE, `${label} is too large`)

const requiredPrice = (label: string) => z.preprocess(toNumber, price(label))
const optionalPrice = (label: string) => z.preprocess(toNumber, price(label).nullish())
const optionalPct = (label: string) =>
  z.preprocess(toNumber, number(label).positive(`${label} must be greater than 0`).max(MAX_PCT, `${label} is too large`).nullish())

const isRealDate = (v: string): boolean => {
  const d = new Date(`${v}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const dateCore = (label: string) =>
  z
    .string({ error: iss => (iss.input === undefined ? `${label} is required` : `${label} must be a date`) })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date (YYYY-MM-DD)`)
    .refine(isRealDate, `${label} is not a real date`)
const requiredDate = (label: string) => dateCore(label)
const optionalDate = (label: string) => z.preprocess(blankToUndefined, dateCore(label).nullish())
const optionalExitDate = (label: string) => z.preprocess(exitDateInput, dateCore(label).nullish())

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} can be at most ${max} characters`)
const optionalText = (label: string, max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `${label} can be at most ${max} characters`).nullish())

const side = z.preprocess(
  v => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.enum(['buy', 'sell'], { error: 'Type must be Buy or Sell' }),
)
const symbol = requiredText('NSE code', 40).transform(s => s.toUpperCase())
const visibility = z.enum(TRADE_VISIBILITIES, { error: 'Free users must be Auto, Show or Hide' })

// ─── Trades ─────────────────────────────────────────────────────────────────
// One shape per board kind. The same schemas validate an Add trade form, an edit, and every row of an upload.

export const intradayTradeSchema = z.object({
  tradeDate: requiredDate('Date'),
  name: requiredText('Stock', 150),
  side,
  entryPrice: requiredPrice('Entry price'),
  exitPrice: requiredPrice('Exit price'),
  visibility: visibility.optional(),
})

export const swingTradeSchema = z.object({
  tradeDate: requiredDate('Date'),
  name: requiredText('Trade name', 150),
  symbol,
  entryPrice: requiredPrice('Entry price'),
  cmp: optionalPrice('CMP'),
  targetPct: optionalPct('Target %'),
  analysis: optionalText('Analysis', 60),
  exitDate: optionalExitDate('Exit date'),
  visibility: visibility.optional(),
})

export const intradayPatchSchema = intradayTradeSchema.partial()
export const swingPatchSchema = swingTradeSchema.partial()

export type IntradayTradeInput = z.infer<typeof intradayTradeSchema>
export type SwingTradeInput = z.infer<typeof swingTradeSchema>

// ─── Boards, settings, periods ──────────────────────────────────────────────

const segment = z.enum(PERFORMANCE_SEGMENTS, { error: 'Unknown segment' })
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM')

export const createBoardSchema = z.object({
  communityId: z.string().uuid('Invalid community id'),
  kind: z.enum(PERFORMANCE_KINDS, { error: 'Board must be intraday, swing or investor' }),
})

export const settingsSchema = z.object({
  hideNewerThanDays: z.number().int().min(0, 'Days cannot be negative').max(365, 'At most 365 days').optional(),
  maxFreeTrades: z.number().int().min(0, 'Trades cannot be negative').max(50, 'At most 50 trades').optional(),
  // Intraday sizing and banner. Rejected by the service on other boards.
  capital: z.number().positive('Capital must be greater than 0').max(MAX_CAPITAL, 'Capital is too large').optional(),
  margin: z.number().min(1, 'Margin must be at least 1x').max(100, 'Margin can be at most 100x').optional(),
  chargesPerTrade: z.number().min(0, 'Charges cannot be negative').max(99_999_999, 'Charges are too large').optional(),
  note: z.string().trim().max(500, 'Note can be at most 500 characters').nullable().optional(),
})

const periodBase = z.object({ segment: segment.optional(), fromMonth: month, toMonth: month })
export const createPeriodSchema = periodBase
export const updatePeriodSchema = periodBase.partial()

export const importBodySchema = z.object({
  segment: segment.optional(),
  dryRun: z.boolean().default(false),
  // Each row is validated on its own so one bad row is a per-row error, not a failed request.
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'The sheet has no rows')
    .max(MAX_IMPORT_ROWS, `A sheet can have at most ${MAX_IMPORT_ROWS} rows`),
})

// ─── Queries ────────────────────────────────────────────────────────────────

export const overviewQuerySchema = z.object({ segment: segment.optional() })
export const segmentBodySchema = z.object({ segment: segment.optional() })

export const listTradesQuerySchema = z.object({
  segment: segment.optional(),
  month: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  // Oldest first reads like the sheet; the all-months view is easier to use newest first.
  order: z.enum(['asc', 'desc']).default('asc'),
})

// `month` is one month; `fromMonth` + `toMonth` is a run of months. Either one narrows the summary and the trades
// together. They are two ways to say the same thing, so mixing them, giving only one end, or running backwards is
// a validation error rather than a guess.
export const mobileTradesQuerySchema = z
  .object({
    segment: segment.optional(),
    month: month.optional(),
    fromMonth: month.optional(),
    toMonth: month.optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((q, ctx) => {
    if (q.month !== undefined && (q.fromMonth !== undefined || q.toMonth !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['month'], message: 'Use month, or fromMonth and toMonth, not both' })
    } else if ((q.fromMonth === undefined) !== (q.toMonth === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [q.fromMonth === undefined ? 'fromMonth' : 'toMonth'],
        message: 'fromMonth and toMonth must be given together',
      })
    } else if (q.fromMonth !== undefined && q.toMonth !== undefined && q.fromMonth > q.toMonth) {
      ctx.addIssue({ code: 'custom', path: ['toMonth'], message: 'toMonth cannot be before fromMonth' })
    }
  })

export type SettingsInput = z.infer<typeof settingsSchema>
export type ListTradesQuery = z.infer<typeof listTradesQuerySchema>
export type MobileTradesQuery = z.infer<typeof mobileTradesQuerySchema>
