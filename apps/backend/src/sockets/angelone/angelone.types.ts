export interface BestFiveEntry {
  price: number
  qty: number
  orders: number
}

export interface SnapQuoteTick {
  mode: number
  exchange: string
  tokenId: string
  seqNo: string
  exchTs: string | null
  ltp: number
  ltq?: number
  atp?: number
  volume?: number
  buyQty?: number
  selQty?: number
  open?: number
  high?: number
  low?: number
  close?: number
  ltTs?: string | null
  openInt?: number
  bestFive?: { buy: BestFiveEntry[]; sell: BestFiveEntry[] }
  upperCircuit?: number
  lowerCircuit?: number
  high52w?: number
  low52w?: number
}

export interface TokenSubscription {
  exchangeType: number
  tokens: string[]
}
