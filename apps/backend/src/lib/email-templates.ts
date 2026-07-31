import { readFileSync } from 'fs'
import path from 'path'
import { env } from '../config/env.js'

export type EmailTemplateId =
  | 'welcome'
  | 'subscription-expiring-7-days'
  | 'subscription-expiring-1-day'
  | 'subscription-expired'
  | 'subscription-extended'
  | 'community-added'
  | 'community-access-removed'
  | 'thread-reply'
  | 'new-announcement'
  | 'admin-unreplied-digest'
  | 'admin-expiry-report'
  | 'admin-new-member'

interface TemplateDef {
  file: string
  // May itself contain {placeholder} tokens — substituted the same way as the body.
  subject: string
}

const TEMPLATE_REGISTRY: Record<EmailTemplateId, TemplateDef> = {
  'welcome': { file: 'welcome.html', subject: 'Your Finskool21 access is live' },
  'subscription-expiring-7-days': { file: 'subscription-expiring-7-days.html', subject: 'Your {community_name} access ends in 7 days' },
  'subscription-expiring-1-day': { file: 'subscription-expiring-1-day.html', subject: 'Last day of your {community_name} access' },
  'subscription-expired': { file: 'subscription-expired.html', subject: 'Your {community_name} access has ended' },
  'subscription-extended': { file: 'subscription-extended.html', subject: "You're active until {valid_till}" },
  'community-added': { file: 'community-added.html', subject: "You've been added to {community_name}" },
  'community-access-removed': { file: 'community-access-removed.html', subject: 'Your {community_name} access has been removed' },
  'thread-reply': { file: 'thread-reply.html', subject: '{admin_name} replied to your thread' },
  'new-announcement': { file: 'new-announcement.html', subject: 'New announcement in {community_name}' },
  'admin-unreplied-digest': { file: 'admin-unreplied-digest.html', subject: '{count} member questions are waiting for a reply' },
  'admin-expiry-report': { file: 'admin-expiry-report.html', subject: '{count} subscriptions expiring this week' },
  'admin-new-member': { file: 'admin-new-member.html', subject: '{member_name} has registered' },
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

export function formatEmailAmount(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// Strips common markdown punctuation and collapses whitespace before truncating —
// used to build post/reply excerpts for email bodies from raw markdown content.
export function truncateText(raw: string, maxLen = 160): string {
  const plain = raw.replace(/[#*_`>~-]/g, '').replace(/\s+/g, ' ').trim()
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`
}

// Row-template convention for the `{rows_html}` slot in the (currently unwired)
// admin-unreplied-digest / admin-expiry-report templates.
export function buildEmailRows(rows: { label: string; value: string }[]): string {
  return rows
    .map(
      r => `
    <tr>
      <td style="font-family:'Nunito', Arial, Helvetica, sans-serif; font-size:13px; color:#153D3A; padding:8px 0; border-bottom:1px solid #E6E3DA;">${escapeHtml(r.label)}</td>
      <td align="right" style="font-family:'Nunito', Arial, Helvetica, sans-serif; font-size:13px; font-weight:700; color:#153D3A; padding:8px 0; border-bottom:1px solid #E6E3DA;">${escapeHtml(r.value)}</td>
    </tr>`,
    )
    .join('')
}
