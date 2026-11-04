import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { isBillingConfigured, loadBillingSettings } from '../modules/services/billing-settings.js'
import type { PlanListItemDTO } from '../modules/payments/payments.dto.js'
import { computeQuoteAmounts, paiseToRupees, rupeesToPaise } from '../modules/services/services.billing.js'

// A plan's price is what the admin set, before GST. GST is added on top, so Razorpay charges the total and the invoice
// shows the split. The rate is the one in Settings > Billing, the same one quotes use, and the rounding is the quote
// rounding too (half-up to the paisa on the GST), so a plan and a quote of the same amount never disagree.

export interface GstRules {
  /** GST is added only once the seller's billing details are complete (GSTIN, state, SAC...) and the rate is above 0. */
  applies: boolean
  ratePercent: number
}

export interface PlanPricing {
  gstApplies: boolean
  /** 0 when GST is not added. */
  ratePercent: number
  basePaise: number
  gstPaise: number
  /** What Razorpay charges. */
  totalPaise: number
}

export async function loadGstRules(db: PrismaClient | Prisma.TransactionClient): Promise<GstRules> {
  const settings = await loadBillingSettings(db)
  const ratePercent = Number(settings.defaultGstRatePercent)
  return { applies: isBillingConfigured(settings) && ratePercent > 0, ratePercent }
}

/** The plan's price with GST on top. Paise throughout, so the only rounding is on the GST. */
export function priceWithGst(price: Prisma.Decimal | number | string, rules: GstRules): PlanPricing {
  const basePaise = rupeesToPaise(price.toString())
  if (!rules.applies) return { gstApplies: false, ratePercent: 0, basePaise, gstPaise: 0, totalPaise: basePaise }
  const { gstPaise, totalPaise } = computeQuoteAmounts(basePaise, Math.round(rules.ratePercent * 100))
  return { gstApplies: true, ratePercent: rules.ratePercent, basePaise, gstPaise, totalPaise }
}

/** A plan as the app lists it: the price the admin set, and what GST makes of it. The one place this is built. */
export function planListItem(plan: { id: string; name: string; durationMonths: number; price: Prisma.Decimal | number | string }, rules: GstRules): PlanListItemDTO {
  const pricing = priceWithGst(plan.price, rules)
  return {
    id: plan.id,
    name: plan.name,
    durationMonths: plan.durationMonths,
    price: Number(plan.price),
    gstRatePercent: pricing.ratePercent,
    gstAmount: paiseToRupees(pricing.gstPaise),
    totalAmount: paiseToRupees(pricing.totalPaise),
  }
}
