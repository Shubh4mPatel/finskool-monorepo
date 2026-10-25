import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import type { BillingSettingsDTO } from './services.dto.js'
import type { BillingSettingsInput } from './services.validator.js'

export type BillingSettingsRow = Prisma.BillingSettingsGetPayload<object>

/**
 * The single settings row; created with the defaults (18% GST, 5-day quotes, prefix FS) on first read.
 * Two first-ever reads can arrive together (the admin form asks for several things at once), so the
 * insert ignores a duplicate instead of failing: whoever loses the race just reads the winner's row.
 */
export async function loadBillingSettings(db: PrismaClient | Prisma.TransactionClient): Promise<BillingSettingsRow> {
  const existing = await db.billingSettings.findUnique({ where: { id: 'default' } })
  if (existing) return existing
  await db.billingSettings.createMany({ data: [{ id: 'default' }], skipDuplicates: true })
  return db.billingSettings.findUniqueOrThrow({ where: { id: 'default' } })
}

/** Seller details with every field a GST invoice needs. Quotes can't be sent and invoices can't be issued without them. */
export type ConfiguredBillingSettings = BillingSettingsRow & {
  legalName: string
  addressLine: string
  city: string
  pincode: string
  stateCode: string
  gstin: string
  sacCode: string
}

export function isBillingConfigured(s: BillingSettingsRow): s is ConfiguredBillingSettings {
  return Boolean(s.legalName && s.addressLine && s.city && s.pincode && s.stateCode && s.gstin && s.sacCode)
}

export function mapBillingSettings(s: BillingSettingsRow): BillingSettingsDTO {
  return {
    legalName: s.legalName,
    addressLine: s.addressLine,
    city: s.city,
    pincode: s.pincode,
    stateCode: s.stateCode,
    gstin: s.gstin,
    sacCode: s.sacCode,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    footerNote: s.footerNote,
    defaultGstRatePercent: Number(s.defaultGstRatePercent),
    defaultQuoteExpiryDays: s.defaultQuoteExpiryDays,
    invoicePrefix: s.invoicePrefix,
    isConfigured: isBillingConfigured(s),
    updatedAt: s.updatedAt.toISOString(),
  }
}

export async function saveBillingSettings(db: PrismaClient, adminId: string, input: BillingSettingsInput): Promise<BillingSettingsDTO> {
  const data = {
    legalName: input.legalName,
    addressLine: input.addressLine,
    city: input.city,
    pincode: input.pincode,
    stateCode: input.stateCode,
    gstin: input.gstin,
    sacCode: input.sacCode,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    footerNote: input.footerNote ?? null,
    defaultGstRatePercent: input.defaultGstRatePercent.toFixed(2),
    defaultQuoteExpiryDays: input.defaultQuoteExpiryDays,
    invoicePrefix: input.invoicePrefix,
    updatedBy: adminId,
  }
  const row = await db.billingSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data })
  return mapBillingSettings(row)
}
