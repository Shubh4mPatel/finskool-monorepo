import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import { decryptPan } from '../../src/lib/pan-crypto.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestMobileMember } from '../helpers/fixtures.js'

// Date of birth and PAN from the mobile app: the flag (GET), the first save (POST) and the edit (PUT). The server
// encrypts the PAN with PAN_ENCRYPTION_KEY; without a usable key a save must fail clearly (503), not as a bare 500.

const app = createApp()
const KEY = 'ab'.repeat(32)
const pan = env.pan as { encryptionKey: string }
const ORIGINAL_KEY = pan.encryptionKey

let member: TestMobileMember
let other: TestMobileMember

const call = (m: TestMobileMember, method: 'get' | 'post' | 'put', body?: unknown) => {
  const req = request(app)[method]('/api/v1/auth/mobile/me/kyc').set('Cookie', mobileCookie(m))
  return body === undefined ? req : req.send(body as object)
}
const good = { dateOfBirth: '1995-04-12', panNumber: 'ABCDE1234F' }

beforeEach(async () => {
  await resetDb()
  pan.encryptionKey = KEY
  const admin = await createAdmin()
  const community = await createCommunity(admin.id)
  const sub = { communityId: community.id, validUntil: daysFromNow(60) }
  member = await createMobileMember({ subscriptions: [sub] })
  other = await createMobileMember({ subscriptions: [sub] })
})

afterEach(() => {
  pan.encryptionKey = ORIGINAL_KEY
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('when the server has no usable encryption key', () => {
  it.each([
    ['not set', ''],
    ['the placeholder from .env.example', 'YOUR_64_HEX_CHAR_KEY'],
    ['too short', 'abcd'],
    ['not hex', 'z'.repeat(64)],
  ])('saving (%s) answers 503 KYC_UNAVAILABLE and writes nothing', async (_label, key) => {
    pan.encryptionKey = key
    const first = await call(member, 'post', good)
    expect(first).toMatchObject({ status: 503 })
    expect(first.body.code).toBe('KYC_UNAVAILABLE')
    expect(first.body.message).not.toMatch(/PAN_ENCRYPTION_KEY/) // the member is not shown server settings
    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(row.panEncrypted).toBeNull()
    expect(row.dateOfBirth).toBeNull()
  })

  it('editing answers 503 too, and the flag says the form is not available yet', async () => {
    await call(member, 'post', good)
    pan.encryptionKey = ''
    expect((await call(member, 'put', { panNumber: 'PQRST6789U' })).status).toBe(503)
    const flag = await call(member, 'get')
    expect(flag.status).toBe(200)
    expect(flag.body.data).toMatchObject({ completed: true, available: false, panMasked: null })
  })

  it('the flag for a member who has not submitted says completed false and available false', async () => {
    pan.encryptionKey = ''
    expect((await call(member, 'get')).body.data).toMatchObject({ completed: false, available: false })
  })
})

describe('with a key', () => {
  it('a new member: flag is not completed, form is available', async () => {
    expect((await call(member, 'get')).body.data).toEqual({ completed: false, available: true, dateOfBirth: null, panMasked: null })
  })

  it('saves the date of birth and the PAN encrypted, and the flag then shows them masked', async () => {
    expect((await call(member, 'post', { dateOfBirth: '1995-04-12', panNumber: ' abcde1234f ' })).status).toBe(201)
    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(row.panEncrypted).toMatch(/^v1:/)
    expect(row.panEncrypted).not.toContain('ABCDE')
    expect(decryptPan(row.panEncrypted!)).toBe('ABCDE1234F')
    expect(row.kycSubmittedAt).not.toBeNull()
    expect((await call(member, 'get')).body.data).toEqual({ completed: true, available: true, dateOfBirth: '1995-04-12', panMasked: 'XXXXXX234F' })
  })

  it('a second first-time save is a 409 and changes nothing; the edit route changes it', async () => {
    await call(member, 'post', good)
    const again = await call(member, 'post', { dateOfBirth: '1990-01-01', panNumber: 'ZZZZZ9999Z' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('KYC_ALREADY_SUBMITTED')
    const edit = await call(member, 'put', { dateOfBirth: '1996-05-20', panNumber: 'PQRST6789U' })
    expect(edit.status).toBe(200)
    expect(edit.body.data).toMatchObject({ dateOfBirth: '1996-05-20', panMasked: 'XXXXXX789U' })
  })

  it('editing before the first save is a 409', async () => {
    const res = await call(member, 'put', { panNumber: 'PQRST6789U' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('KYC_NOT_SUBMITTED')
  })

  it('one member\'s details never show up for another', async () => {
    await call(member, 'post', good)
    expect((await call(other, 'get')).body.data.completed).toBe(false)
  })

  it('15 taps at once save once; the rest are clean 409s', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => call(member, 'post', good)))
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(results.filter(r => r.status === 409)).toHaveLength(14)
  })
})

describe('what the app can send, and the error it gets back', () => {
  // The 422 body carries the reason per field: { message: 'Validation failed', errors: { dateOfBirth: ['...'] } }.
  it.each([
    ['a day-first date', { dateOfBirth: '12/04/1995', panNumber: 'ABCDE1234F' }, 'dateOfBirth', /YYYY-MM-DD/],
    ['a full ISO timestamp', { dateOfBirth: '1995-04-12T00:00:00.000Z', panNumber: 'ABCDE1234F' }, 'dateOfBirth', /YYYY-MM-DD/],
    ['a date that does not exist', { dateOfBirth: '1995-02-30', panNumber: 'ABCDE1234F' }, 'dateOfBirth', /valid date of birth/],
    ['a future date', { dateOfBirth: '2999-01-01', panNumber: 'ABCDE1234F' }, 'dateOfBirth', /future/],
    ['a PAN with a space inside', { dateOfBirth: '1995-04-12', panNumber: 'ABCDE 1234F' }, 'panNumber', /valid PAN/],
    ['a PAN that is too short', { dateOfBirth: '1995-04-12', panNumber: 'ABCDE123' }, 'panNumber', /valid PAN/],
    ['a missing PAN', { dateOfBirth: '1995-04-12' }, 'panNumber', undefined],
    ['a missing date of birth', { panNumber: 'ABCDE1234F' }, 'dateOfBirth', undefined],
    ['a PAN sent as a number', { dateOfBirth: '1995-04-12', panNumber: 12345 }, 'panNumber', undefined],
  ])('%s -> 422 naming the field', async (_label, body, field, message) => {
    const res = await call(member, 'post', body)
    expect(res.status).toBe(422)
    expect(res.body.errors[field]).toBeDefined()
    if (message) expect(res.body.errors[field][0]).toMatch(message)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).panEncrypted).toBeNull()
  })

  it('an empty edit is a 422', async () => {
    await call(member, 'post', good)
    expect((await call(member, 'put', {})).status).toBe(422)
  })

  it('a web login (JWT) is refused: the details are saved from the mobile app only', async () => {
    const token = jwt.sign({ sub: member.id, role: 'member', type: 'access', communityIds: [], selectedCommunityId: null, accessibleCommunityIds: [], isSuperAdmin: false }, env.jwt.secret)
    const res = await request(app).post('/api/v1/auth/mobile/me/kyc').set('Authorization', `Bearer ${token}`).send(good)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MOBILE_ONLY')
  })

  it('no session is a 401', async () => {
    expect((await request(app).post('/api/v1/auth/mobile/me/kyc').send(good)).status).toBe(401)
    expect((await request(app).get('/api/v1/auth/mobile/me/kyc')).status).toBe(401)
  })

  it('a suspended member is signed out (401), nothing is saved', async () => {
    await prisma.user.update({ where: { id: member.id }, data: { status: 'suspended' } })
    expect((await call(member, 'post', good)).status).toBe(401)
  })
})
