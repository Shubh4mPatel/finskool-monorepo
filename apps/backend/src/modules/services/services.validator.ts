import { z } from 'zod'
import { MAX_BODY_LENGTH } from '../tickets/tickets.validator.js'
import { isGstStateCode, isValidGstin } from './services.billing.js'
import { MAX_SERVICE_HIGHLIGHTS, MAX_SERVICE_TAGS, MAX_WHAT_MEMBERS_GET, SERVICE_TYPE_KEYS } from './services.catalog.js'

// Chat bodies, attachments, ratings, paging and presign share their rules with the ticket module.
export {
  clientKeySchema,
  listMessagesQuerySchema,
  presignSchema,
  ratingSchema,
  reassignSchema,
  sendMessageSchema,
} from '../tickets/tickets.validator.js'
export type { ListMessagesQuery, PresignDTO, RatingDTO, SendMessageDTO } from '../tickets/tickets.validator.js'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../tickets/tickets.validator.js'

const statuses = ['requested', 'quote_sent', 'paid', 'closed'] as const

const attachmentRef = z.object({
  objectKey: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
})

export const createServiceRequestSchema = z.object({
  serviceId: z.string().uuid(),
  needs: z.string().trim().min(1, 'Please describe what you need').max(MAX_BODY_LENGTH),
  attachments: z.array(attachmentRef).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
})

const limit = z.coerce.number().int().min(1).max(50).default(20)

export const listServiceRequestsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

export const adminListServiceRequestsQuerySchema = z.object({
  status: z.enum(statuses).optional(),
  // 'true' = not closed yet (matches the open-request counters in /stats)
  open: z.enum(['true', 'false']).optional(),
  serviceId: z.string().uuid().optional(),
  // One member's requests
  userId: z.string().uuid().optional(),
  // 'me' | 'unassigned' | <admin uuid>
  assignee: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
  unread: z.enum(['true', 'false']).optional(),
  // 'true' = only requests with a payment that needs an admin's attention
  review: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit,
})

// ─── Catalog ────────────────────────────────────────────────────────────────

const imageUrl = z.string().trim().url().max(500)

// Tags are shown as hashtags, so the leading '#' is dropped and case is ignored when de-duplicating.
const tag = z
  .string()
  .trim()
  .transform(v => v.replace(/^#+/, '').trim())
  .pipe(z.string().min(1).max(30).regex(/^[\p{L}\p{N}][\p{L}\p{N} &_-]*$/u, 'Tags can use letters, numbers, spaces, & _ -'))
const tags = z
  .array(tag)
  .max(MAX_SERVICE_TAGS, `At most ${MAX_SERVICE_TAGS} tags`)
  .transform(list => list.filter((t, i) => list.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i))
const highlights = z.array(z.string().trim().min(1).max(40)).max(MAX_SERVICE_HIGHLIGHTS, `At most ${MAX_SERVICE_HIGHLIGHTS} highlights`)
const whatMembersGet = z.array(z.string().trim().min(1).max(150)).max(MAX_WHAT_MEMBERS_GET, `At most ${MAX_WHAT_MEMBERS_GET} points`)

const catalogFields = {
  // "Service name" in the form: what members see on the card and in the chat.
  title: z.string().trim().min(1, 'Service name is required').max(200),
  // Optional internal label; defaults to the service name.
  name: z.string().trim().min(1).max(150),
  // Markdown.
  description: z.string().trim().min(1, 'Description is required').max(5000),
  imageUrl: imageUrl,
  iconUrl: imageUrl,
  serviceType: z.enum(SERVICE_TYPE_KEYS),
  tags,
  highlights,
  whatMembersGet,
  isActive: z.boolean(),
}

export const createCatalogServiceSchema = z.object({
  title: catalogFields.title,
  name: catalogFields.name.optional(),
  description: catalogFields.description,
  imageUrl: catalogFields.imageUrl.nullish(),
  iconUrl: catalogFields.iconUrl.nullish(),
  serviceType: catalogFields.serviceType,
  tags: catalogFields.tags.default([]),
  highlights: catalogFields.highlights.default([]),
  whatMembersGet: catalogFields.whatMembersGet.default([]),
  isActive: catalogFields.isActive.default(true),
})

export const updateCatalogServiceSchema = z
  .object({
    title: catalogFields.title,
    name: catalogFields.name,
    description: catalogFields.description,
    imageUrl: catalogFields.imageUrl.nullable(),
    iconUrl: catalogFields.iconUrl.nullable(),
    serviceType: catalogFields.serviceType,
    tags: catalogFields.tags,
    highlights: catalogFields.highlights,
    whatMembersGet: catalogFields.whatMembersGet,
    isActive: catalogFields.isActive,
  })
  .partial()
  .refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

export const catalogImagePresignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
})

export type CreateServiceRequestDTO = z.infer<typeof createServiceRequestSchema>
export type ListServiceRequestsQuery = z.infer<typeof listServiceRequestsQuerySchema>
export type AdminListServiceRequestsQuery = z.infer<typeof adminListServiceRequestsQuerySchema>
export type CreateCatalogServiceDTO = z.infer<typeof createCatalogServiceSchema>
export type UpdateCatalogServiceDTO = z.infer<typeof updateCatalogServiceSchema>

// ─── Quotes, payments, billing settings ─────────────────────────────────────

/** Upper bound for the pre-GST amount of one quote, in rupees. */
export const MAX_QUOTE_BASE_AMOUNT = 1_000_000

const hasAtMostTwoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
const rupees = z.number().positive().max(MAX_QUOTE_BASE_AMOUNT).refine(hasAtMostTwoDecimals, 'At most 2 decimal places')
const percent = z.number().min(0).max(100).refine(hasAtMostTwoDecimals, 'At most 2 decimal places')

export const sendQuoteSchema = z.object({
  // Before GST. GST is added on top at the configured (or overridden) rate.
  baseAmount: rupees,
  note: z.string().trim().max(1000).optional(),
  // Defaults come from the billing settings.
  expiryDays: z.number().int().min(1).max(90).optional(),
  gstRatePercent: percent.optional(),
  // Set to replace a quote the member started paying in the last few minutes.
  confirmReplace: z.boolean().optional(),
})

const stateCode = z.string().trim().refine(isGstStateCode, 'Choose a valid state')
const gstin = z
  .string()
  .trim()
  .transform(v => v.toUpperCase())
  .refine(isValidGstin, 'Enter a valid GSTIN')

/** GSTIN's first two digits are the state code: they must agree with the state chosen next to it. */
const gstinMatchesState = (v: { gstin?: string | undefined; stateCode: string }) => !v.gstin || v.gstin.slice(0, 2) === v.stateCode

export const payQuoteSchema = z.object({
  billing: z
    .object({
      name: z.string().trim().min(1, 'Name is required').max(150),
      stateCode,
      // Only for members who want the invoice in their business name with input credit.
      gstin: gstin.optional(),
      address: z.string().trim().max(300).optional(),
    })
    .refine(gstinMatchesState, { message: 'GSTIN does not belong to the selected state', path: ['gstin'] }),
})

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().trim().min(1).max(64),
  razorpayPaymentId: z.string().trim().min(1).max(64),
  razorpaySignature: z.string().trim().min(1).max(256),
})

export const billingSettingsSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    addressLine: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(100),
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit pincode'),
    stateCode,
    gstin,
    // Service Accounting Code of the service, as given by your accountant.
    sacCode: z.string().trim().regex(/^[0-9]{4,8}$/, 'SAC is 4 to 8 digits'),
    contactEmail: z.string().trim().email().max(255).optional(),
    contactPhone: z.string().trim().max(30).optional(),
    footerNote: z.string().trim().max(500).optional(),
    defaultGstRatePercent: percent,
    defaultQuoteExpiryDays: z.number().int().min(1).max(90),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,10}$/, 'Up to 10 capital letters or digits'),
  })
  .refine(gstinMatchesState, { message: 'GSTIN does not belong to the selected state', path: ['gstin'] })

export type SendQuoteDTO = z.infer<typeof sendQuoteSchema>
export type PayQuoteDTO = z.infer<typeof payQuoteSchema>
export type VerifyPaymentDTO = z.infer<typeof verifyPaymentSchema>
export type BillingSettingsInput = z.infer<typeof billingSettingsSchema>
