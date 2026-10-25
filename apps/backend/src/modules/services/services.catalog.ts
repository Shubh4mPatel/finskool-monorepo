/** The kinds of service the catalog offers. The key is what is stored; the label is what people see. */
export const SERVICE_TYPES = [
  { key: 'long_term_investment', label: 'Long Term Investment' },
  { key: 'expert_advisory', label: 'Expert Advisory' },
  { key: 'portfolio_management', label: 'Portfolio Management' },
  { key: 'trading_strategy', label: 'Trading Strategy' },
  { key: 'wealth_planning', label: 'Wealth Planning' },
  { key: 'tax_compliance', label: 'Tax & Compliance' },
] as const

export type ServiceTypeKey = (typeof SERVICE_TYPES)[number]['key']

export const SERVICE_TYPE_KEYS = SERVICE_TYPES.map(t => t.key) as [ServiceTypeKey, ...ServiceTypeKey[]]

export function serviceTypeOf(key: string | null): { key: string; label: string } | null {
  if (!key) return null
  return SERVICE_TYPES.find(t => t.key === key) ?? null
}

export const MAX_SERVICE_TAGS = 10
export const MAX_SERVICE_HIGHLIGHTS = 3
export const MAX_WHAT_MEMBERS_GET = 8
