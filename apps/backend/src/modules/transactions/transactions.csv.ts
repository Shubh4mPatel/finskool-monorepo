import type { TransactionDTO } from './transactions.service.js'

const IST_OFFSET_MS = 330 * 60 * 1000

/** "2026-11-13 10:24" in IST: the time admins see on the screen. */
const istStamp = (iso: string): string => new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')

// A member's name or a failure message is free text; a spreadsheet would run one that starts with = + - @ as a formula.
const cell = (v: string): string => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`

const STATUS_LABEL = { paid: 'Paid', failed: 'Failed', flagged: 'Flagged' } as const

export function transactionsToCsv(items: TransactionDTO[]): string {
  const header = ['Invoice', 'Payment ID', 'Order ID', 'Member', 'Email', 'Type', 'Paid for', 'Plan', 'Amount (INR)', 'Status', 'Method', 'Reason', 'Date (IST)']
  const rows = items.map(t => [
    t.invoice?.number ?? '',
    t.paymentId ?? '',
    t.orderId ?? '',
    t.member.name,
    t.member.email ?? '',
    t.kind === 'community' ? 'Community' : 'Service',
    t.paidFor.name,
    t.kind === 'community' ? (t.planName ?? '') : (t.reference ?? ''),
    t.amount.toFixed(2),
    STATUS_LABEL[t.status],
    t.method ?? '',
    t.reason ?? '',
    istStamp(t.occurredAt),
  ])
  // The byte-order mark makes Excel read the file as UTF-8.
  return '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\n')
}
