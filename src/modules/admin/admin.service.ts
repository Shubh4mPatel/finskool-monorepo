import { createRequire } from 'module'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type { DuplicateStrategy, ImportSummaryDTO } from './admin.dto.js'

const _require = createRequire(import.meta.url)
const XLSX = _require('xlsx') as {
  read(data: Buffer, opts: object): { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json<T>(ws: unknown, opts?: object): T[] }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return null
}

function parseDate(raw: string): Date | null {
  if (!raw.trim()) return null
  const d = new Date(raw.trim())
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null
  return d
}

export class AdminService {
  constructor(private readonly db: PrismaClient) {}

  async importUsers(
    buffer: Buffer,
    adminId: string,
    strategy: DuplicateStrategy,
  ): Promise<ImportSummaryDTO> {
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })

    // SheetNames[0] is string | undefined with noUncheckedIndexedAccess
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) throw new BadRequestError('The uploaded file contains no sheets')
    const sheet = workbook.Sheets[sheetName]

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    // normalize header keys (trim whitespace — CSV has "Valid " with trailing space)
    const rows: Record<string, string>[] = rawRows.map(rawRow =>
      Object.fromEntries(
        Object.entries(rawRow).map(([k, v]) => [k.trim(), String(v ?? '').trim()]),
      ),
    )

    const summary: ImportSummaryDTO = {
      total: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    const communities = await this.db.community.findMany({
      select: { id: true, name: true },
    })

    // use entries() so we get index + element without noUncheckedIndexedAccess issues
    for (const [i, row] of rows.entries()) {
      const rowNum = i + 2 // +1 for header, +1 for 1-based index

      const rawPhone = row['Contact Number'] ?? ''
      const phone = normalizePhone(rawPhone)
      if (!phone) {
        summary.errors.push({ row: rowNum, phone: rawPhone, reason: 'Invalid phone number' })
        continue
      }

      const rawService = row['Service'] ?? ''
      // exact case-insensitive match — ambiguous values flagged as errors
      const community = communities.find(
        c => c.name.toLowerCase() === rawService.toLowerCase(),
      )
      if (!community) {
        summary.errors.push({
          row: rowNum,
          phone,
          reason: `No community matched "${rawService}" — fix the CSV and re-import`,
        })
        continue
      }

      const rawPayment = (row['Payment'] ?? '').replace(/[^0-9.]/g, '')
      const payment = parseFloat(rawPayment)
      if (isNaN(payment) || payment <= 0) {
        summary.errors.push({ row: rowNum, phone, reason: 'Invalid payment amount' })
        continue
      }

      const validUntil = parseDate(row['Valid'] ?? '')
      if (!validUntil) {
        summary.errors.push({ row: rowNum, phone, reason: 'Invalid or missing valid-until date' })
        continue
      }

      const paidOn = parseDate(row['Paid on'] ?? '') // nullable — "9 June" without year → null
      const name = row['Name'] ?? ''
      const email = (row['Email'] ?? '').toLowerCase()

      const existing = await this.db.approvedPhone.findUnique({ where: { phone } })

      if (existing) {
        if (strategy === 'skip') {
          summary.skipped++
          continue
        }

        // overwrite — update everything except isRegistered (never touched by import)
        await this.db.$transaction(async tx => {
          await tx.approvedPhone.update({
            where: { phone },
            data: { name, email, addedBy: adminId },
          })
          // isActive on subscription intentionally not touched — admin controls it separately
          await tx.subscription.upsert({
            where: {
              uq_subscription_phone_community: {
                approvedPhoneId: existing.id,
                communityId: community.id,
              },
            },
            create: {
              approvedPhoneId: existing.id,
              communityId: community.id,
              payment,
              paidOn,
              validUntil,
            },
            update: { payment, paidOn, validUntil },
          })
        })
        summary.updated++
      } else {
        await this.db.$transaction(async tx => {
          const ap = await tx.approvedPhone.create({
            data: { phone, name, email, addedBy: adminId },
          })
          await tx.subscription.create({
            data: {
              approvedPhoneId: ap.id,
              communityId: community.id,
              payment,
              paidOn,
              validUntil,
            },
          })
        })
        summary.created++
      }
    }

    logger.info(summary, 'admin.importUsers: complete')
    return summary
  }
}
