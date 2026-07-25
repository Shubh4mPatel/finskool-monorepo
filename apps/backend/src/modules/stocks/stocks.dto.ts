export interface StockResponseDTO {
  id: string
  name: string
  symbol: string
  sector: string | null
  exchange: 'nse' | 'bse' | null
  cmp: number | null
}
