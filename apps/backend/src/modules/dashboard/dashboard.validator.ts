import { z } from 'zod'

const limit = z.coerce.number().int().min(1).max(20).default(5)

export const listQuerySchema = z.object({ limit })

export const expiringQuerySchema = z.object({ limit })

export const revenueQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .refine(m => Number(m.slice(0, 4)) >= 2000, 'month is too far in the past')
    .optional(),
})
