export type DuplicateStrategy = 'skip' | 'overwrite'

export interface ImportErrorDTO {
  row: number
  phone: string
  reason: string
}

export interface ImportSummaryDTO {
  total: number
  created: number
  updated: number
  skipped: number
  errors: ImportErrorDTO[]
}
