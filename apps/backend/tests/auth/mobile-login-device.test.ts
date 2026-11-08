import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { notificationsQueue, MOBILE_NEW_LOGIN_EMAIL_JOB } from '../../src/lib/queue.js'
import { buildEmailRows, renderEmail } from '../../src/lib/email-templates.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, daysFromNow } from '../helpers/fixtures.js'

// The "someone signed in on <phone> from <place>" email: the app may say what the phone is and where it is; both are optional.

const app = createApp()
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

async function member() {
  const admin = await createAdmin()
  const community = await createCommunity(admin.id)
  return createMobileMember({ loggedIn: false, subscriptions: [{ communityId: community.id, validUntil: daysFromNow(30) }] })
}

const login = (m: { email: string | null; password: string | null }, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/auth/mobile/login').set('User-Agent', ANDROID_UA).send({ email: m.email, password: m.password, ...extra })

const queuedLoginJob = () => vi.mocked(notificationsQueue.add).mock.calls.find(c => c[0] === MOBILE_NEW_LOGIN_EMAIL_JOB)?.[1] as Record<string, unknown> | undefined

beforeEach(async () => {
  await resetDb()
  vi.mocked(notificationsQueue.add).mockClear()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('what a mobile login records about the phone', () => {
  it('keeps the device name and location the app sends, and puts them in the new-login email job', async () => {
    const m = await member()
    const res = await login(m, { deviceName: '  Pixel 8  ', location: 'Mumbai, India' })

    expect(res.status).toBe(200)
    const session = await prisma.mobileSession.findUniqueOrThrow({ where: { userId: m.id } })
    expect(session).toMatchObject({ deviceName: 'Pixel 8', location: 'Mumbai, India' })
    expect(queuedLoginJob()).toMatchObject({ deviceName: 'Pixel 8', location: 'Mumbai, India' })
  })

  it('falls back to the device read from the request, with no location, when the app sends neither', async () => {
    const m = await member()
    const res = await login(m)

    expect(res.status).toBe(200)
    const session = await prisma.mobileSession.findUniqueOrThrow({ where: { userId: m.id } })
    expect(session.deviceName).toMatch(/Chrome/)
    expect(session.location).toBeNull()
    expect(queuedLoginJob()).toBeDefined()
    expect(queuedLoginJob()).not.toHaveProperty('location')
  })

  it('treats blank values as not sent, and refuses absurdly long ones', async () => {
    const m = await member()
    expect((await login(m, { deviceName: '   ', location: '' })).status).toBe(200)
    const session = await prisma.mobileSession.findUniqueOrThrow({ where: { userId: m.id } })
    expect(session.deviceName).toMatch(/Chrome/)
    expect(session.location).toBeNull()

    expect((await login(m, { location: 'x'.repeat(121) })).status).toBe(422)
  })
})

describe('the new-login email', () => {
  const render = (data: { location?: string }) =>
    renderEmail('mobile-new-login', {
      first_name: 'Sandeep',
      device_name: 'Pixel 8',
      location_phrase: data.location ? ` from ${data.location}` : '',
      rows_html: buildEmailRows([
        { label: 'Device', value: 'Pixel 8' },
        ...(data.location ? [{ label: 'Location', value: data.location }] : []),
        { label: 'Time', value: '8 Nov 2026, 9:05 am' },
      ]),
    }).html

  it('says which phone and from where, and lists both', () => {
    const html = render({ location: 'Mumbai, India' })
    expect(html).toContain('Pixel 8 from Mumbai, India</strong>')
    expect(html).toContain('>Location</td>')
    expect(html).toContain('>Mumbai, India</td>')
  })

  it('leaves the place out entirely when the app did not say', () => {
    const html = render({})
    expect(html).toContain('using <strong style="color:#1A1F1E;">Pixel 8</strong>')
    expect(html).not.toContain('Location')
    expect(html).not.toContain(' from ')
  })

  it('escapes what the app sent', () => {
    const html = render({ location: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
