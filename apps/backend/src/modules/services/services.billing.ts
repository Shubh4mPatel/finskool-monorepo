// Pure money / GST helpers for service quotes and invoices. Amounts are handled as integer paise
// so that rounding is exact; Decimal(12,2) rupees only appear at the database boundary.

export interface GstState {
  code: string
  name: string
}

/** GST state / UT codes (the first two digits of every GSTIN). */
export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
]

const STATE_BY_CODE = new Map(GST_STATES.map(s => [s.code, s.name]))

export const isGstStateCode = (code: string): boolean => STATE_BY_CODE.has(code)
export const gstStateName = (code: string): string => STATE_BY_CODE.get(code) ?? code

// ─── GSTIN ──────────────────────────────────────────────────────────────────

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Format + state code + the official mod-36 check character. */
export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_SHAPE.test(gstin) || !isGstStateCode(gstin.slice(0, 2))) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(gstin[i]!)
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14]
}

// ─── Amounts ────────────────────────────────────────────────────────────────

export const rupeesToPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100)
export const paiseToRupees = (paise: number): number => paise / 100
/** For Prisma Decimal columns. */
export const paiseToDecimal = (paise: number): string => (paise / 100).toFixed(2)

export interface QuoteAmounts {
  basePaise: number
  gstPaise: number
  totalPaise: number
}

/** GST on top of the base amount, rounded half-up to the paisa. `rateBps` is the rate x 100 (18% = 1800). */
export function computeQuoteAmounts(basePaise: number, rateBps: number): QuoteAmounts {
  const gstPaise = Math.floor((basePaise * rateBps + 5000) / 10000)
  return { basePaise, gstPaise, totalPaise: basePaise + gstPaise }
}

export interface GstSplit {
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
}

/** Same state: CGST + SGST (half each, the odd paisa goes to SGST). Different state: IGST. The total never changes. */
export function splitGst(gstPaise: number, sellerStateCode: string, buyerStateCode: string): GstSplit {
  if (sellerStateCode === buyerStateCode) {
    const cgstPaise = Math.floor(gstPaise / 2)
    return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 }
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise }
}

// ─── Invoice numbering ──────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Indian financial year (April to March, in IST) as "2026-27". */
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  const year = ist.getUTCFullYear()
  const start = ist.getUTCMonth() >= 3 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export const formatInvoiceNumber = (prefix: string, financialYear: string, sequence: number): string =>
  `${prefix}/${financialYear}/${String(sequence).padStart(4, '0')}`

// ─── Amount in words (Indian numbering) ─────────────────────────────────────

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n %= 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : ''))
  } else if (n > 0) {
    parts.push(ONES[n]!)
  }
  return parts.join(' ')
}

function wholeNumberInWords(n: number): string {
  if (n === 0) return 'Zero'
  const units: [number, string][] = [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']]
  const parts: string[] = []
  for (const [size, name] of units) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${name}`)
      n %= size
    }
  }
  if (n > 0) parts.push(below1000(n))
  return parts.join(' ')
}

/** "Rupees Twelve Thousand Five Hundred and Fifty Paise Only" */
export function amountInWords(totalPaise: number): string {
  const rupees = Math.floor(totalPaise / 100)
  const paise = totalPaise % 100
  const rupeePart = `Rupees ${wholeNumberInWords(rupees)}`
  return paise > 0 ? `${rupeePart} and ${wholeNumberInWords(paise)} Paise Only` : `${rupeePart} Only`
}
