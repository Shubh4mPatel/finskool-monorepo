import { readFileSync } from 'fs'
import path from 'path'
import { env } from '../config/env.js'

export type EmailTemplateId =
  | 'welcome'
  | 'subscription-expiring-7-days'
  | 'subscription-expiring-1-day'
  | 'subscription-expired'
  | 'subscription-extended'
  | 'service-invoice'
  | 'community-added'
  | 'community-access-removed'
  | 'community-blocked'
  | 'community-unblocked'
  | 'new-announcement'
  | 'admin-new-member'
  | 'admin-payment'
  | 'member-suspended'
  | 'member-reinstated'
  | 'member-password-reset'
  | 'otp-verification'
  | 'password-reset-otp'
  | 'mobile-new-login'

interface TemplateDef {
  file: string
  // May itself contain {placeholder} tokens — substituted the same way as the body.
  subject: string
}

const TEMPLATE_REGISTRY: Record<EmailTemplateId, TemplateDef> = {
  'welcome': { file: 'welcome.html', subject: 'Set up your Finskool21 account' },
  'subscription-expiring-7-days': { file: 'subscription-expiring-7-days.html', subject: 'Your {community_name} access ends in 7 days' },
  'subscription-expiring-1-day': { file: 'subscription-expiring-1-day.html', subject: 'Last day of your {community_name} access' },
  'subscription-expired': { file: 'subscription-expired.html', subject: 'Your {community_name} access has ended' },
  'subscription-extended': { file: 'subscription-extended.html', subject: "You're active until {valid_till}" },
  'service-invoice': { file: 'service-invoice.html', subject: 'Payment received - invoice {invoice_number}' },
  'community-added': { file: 'community-added.html', subject: "You've been added to {community_name}" },
  'community-access-removed': { file: 'community-access-removed.html', subject: 'Your {community_name} access has been removed' },
  'community-blocked': { file: 'community-blocked.html', subject: 'Your {community_name} access has been blocked' },
  'community-unblocked': { file: 'community-unblocked.html', subject: 'Your {community_name} access has been restored' },
  'new-announcement': { file: 'new-announcement.html', subject: 'New announcement in {community_name}' },
  'admin-new-member': { file: 'admin-new-member.html', subject: '{member_name} has registered' },
  'admin-payment': { file: 'admin-payment.html', subject: '{headline}' },
  'member-suspended': { file: 'member-suspended.html', subject: 'Your Finskool21 access has been suspended' },
  'member-reinstated': { file: 'member-reinstated.html', subject: 'Your Finskool21 access has been restored' },
  // The subject never carries the password.
  'member-password-reset': { file: 'member-password-reset.html', subject: 'Your Finskool21 password has been reset' },
  'otp-verification': { file: 'otp-verification.html', subject: 'Your Finskool21 verification code is {otp_code}' },
  'password-reset-otp': { file: 'password-reset-otp.html', subject: 'Your Finskool21 password reset code is {otp_code}' },
  'mobile-new-login': { file: 'mobile-new-login.html', subject: 'New login to your Finskool21 account' },
}

const htmlCache = new Map<EmailTemplateId, string>()

function loadTemplate(id: EmailTemplateId): string {
  const cached = htmlCache.get(id)
  if (cached !== undefined) return cached
  const filePath = path.join(process.cwd(), 'email-template', TEMPLATE_REGISTRY[id].file)
  const html = readFileSync(filePath, 'utf-8')
  htmlCache.set(id, html)
  return html
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Keys ending in `_html` (e.g. rows_html) carry pre-built, trusted markup and are
// inserted raw; every other value is HTML-escaped, since community names, member
// names, post titles and reply excerpts are user-supplied text going straight into
// an HTML document. Missing or undefined values (e.g. a stale queued job whose
// payload predates a field being added) are left as literal `{token}` text (surfaces
// missing-data bugs in MailHog instead of crashing or silently blanking a field).
function substitute(template: string, data: Record<string, string>, escape: boolean): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = data[key]
    if (value === undefined) return match
    if (!escape) return value
    return key.endsWith('_html') ? value : escapeHtml(value)
  })
}

export function renderEmail(templateId: EmailTemplateId, data: Record<string, string>): { subject: string; html: string } {
  const def = TEMPLATE_REGISTRY[templateId]
  // Every template references {logo_url} in its header/footer — inject it here so
  // callers never need to pass it themselves, and swapping the logo is a one-env-var change.
  const withDefaults = { logo_url: env.email.logoUrl, ...data }
  return {
    subject: substitute(def.subject, withDefaults, false),
    html: substitute(loadTemplate(templateId), withDefaults, true),
  }
}

// ---- Shared helpers for building `data` ahead of a renderEmail call ----

export function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim()
  return trimmed.split(/\s+/)[0] ?? trimmed
}

export function formatEmailDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
}

// Like formatEmailDate, but with hour/minute — for events (like a login) where
// the time of day matters, not just the date.
export function formatEmailDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatEmailAmount(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// Strips HTML tags (Post.contentMd is actually Tiptap-generated HTML despite the
// name, not markdown) and leftover markdown punctuation, collapses whitespace, then
// truncates — used to build post/reply excerpts for email bodies. Tags must be
// stripped before the punctuation pass, or a lone `>` from a partially-stripped tag
// gets deleted too, leaving mangled fragments like `<pSome text</p` behind.
export function truncateText(raw: string, maxLen = 160): string {
  const plain = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`
}

// Builds the `{cta_html}` slot for the subscription-expiring-7-days / -1-day
// templates: the button row(s) of the Finskool21 email layout. Without a
// payment link the one button is "Email support to renew". With a payment link,
// that becomes the primary action and the mailto fallback drops to a smaller
// link underneath it.
function renewalButtonRow(href: string, label: string): string {
  return `
                <tr>
                  <td class="px" style="padding:24px 40px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="background:#108B8B; border-radius:10px;">
                        <a href="${href}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:Inter, Helvetica, Arial, sans-serif; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none;">${label}</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>`
}

export function buildRenewalCta(paymentLink: string | null | undefined, mailtoHref: string): string {
  if (!paymentLink) return renewalButtonRow(mailtoHref, 'Email support to renew')

  return `${renewalButtonRow(escapeHtml(paymentLink), 'Pay now to continue')}
                <tr>
                  <td class="px" style="padding:12px 40px 0; font-family:Inter, Helvetica, Arial, sans-serif; font-size:13px;">
                    <a href="${mailtoHref}" target="_blank" style="color:#108B8B; font-weight:600; text-decoration:none;">Or email support to renew</a>
                  </td>
                </tr>`
}

// The `{rows_html}` slot of a template whose label/value rows depend on the data (an optional row, say): the rows of the grey
// details box in the Finskool21 email layout. Labels and values are HTML-escaped here. The first and last rows carry the
// box's top and bottom padding, so the template only supplies the <table> around the slot.
export function buildEmailRows(rows: { label: string; value: string }[]): string {
  const last = rows.length - 1
  return rows
    .map((r, i) => {
      const pad = last === 0 ? '16px 20px' : i === 0 ? '16px 20px 6px' : i === last ? '6px 20px 16px' : '6px 20px'
      return `
                      <tr><td style="padding:${pad}; font-size:13px; color:#8A8F8C;">${escapeHtml(r.label)}</td><td align="right" style="padding:${pad}; font-size:13px; color:#1A1F1E; font-weight:600;">${escapeHtml(r.value)}</td></tr>`
    })
    .join('')
}
