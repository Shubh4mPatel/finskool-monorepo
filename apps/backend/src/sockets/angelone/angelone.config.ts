import { env } from '../../config/env.js'

export const ANGELONE_CONFIG = {
  apiKey: env.angelone.apiKey,
  clientCode: env.angelone.clientCode,
  pin: env.angelone.pin,
  totpSecret: env.angelone.totpSecret,
} as const

/** exchangeType: 1=NSE_CM  2=NSE_FO  3=BSE_CM  4=BSE_FO  5=MCX_FO */
export const EXCHANGE_LABEL: Record<number, string> = {
  1: 'NSE_CM',
  2: 'NSE_FO',
  3: 'BSE_CM',
  4: 'BSE_FO',
  5: 'MCX_FO',
}

/** Maps our `Stock.exchange` to the AngelOne cash-equity exchangeType. */
export const EXCHANGE_TYPE: Record<'nse' | 'bse', number> = {
  nse: 1,
  bse: 3,
}

/** 1=LTP  2=Quote  3=SnapQuote (all fields) */
export const MODE = 3
