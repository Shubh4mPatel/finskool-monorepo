import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// Community covers and service thumbnails must have a 5:2 ratio so every card looks alike. The ratio is read from the
// stored file when the image is saved; an image that is already saved and unchanged is never re-checked.

const stored = new Map<string, Buffer>()
vi.mock('../../src/lib/minio.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/minio.js')>()
  return { ...actual, readOwnObject: async (url: string) => stored.get(url) ?? null }
})

const app = createApp()
let admin: TestAdmin
let seq = 0

async function image(folder: 'communities' | 'services', width: number, height: number, format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg') {
  const base = sharp({ create: { width, height, channels: 3, background: '#117' } })
  const buffer = await (format === 'gif' ? base.gif() : base[format]()).toBuffer()
  const url = `http://storage.test/bucket/${folder}/${++seq}.${format}`
  stored.set(url, buffer)
  return url
}

const createCommunityReq = (coverImageUrl?: string) =>
  request(app).post('/api/v1/admin/communities').set('Authorization', admin.auth).send({ name: `Club ${++seq}`, ...(coverImageUrl ? { coverImageUrl } : {}) })

const serviceBody = (imageUrl?: string) => ({
  title: 'Portfolio Review',
  description: 'We review it.',
  serviceType: 'expert_advisory',
  ...(imageUrl ? { imageUrl } : {}),
})

beforeEach(async () => {
  await resetDb()
  stored.clear()
  admin = await createAdmin({ isSuperAdmin: true })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('community cover image', () => {
  it('accepts 5:2, including a pixel of rounding, in JPG, PNG and WebP', async () => {
    for (const [w, h, f] of [[1500, 600, 'jpeg'], [1001, 400, 'png'], [1000, 400, 'webp']] as const) {
      const res = await createCommunityReq(await image('communities', w, h, f))
      expect(res.status).toBe(201)
    }
  })

  it('rejects another ratio and says what the image is', async () => {
    const res = await createCommunityReq(await image('communities', 1200, 675))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'BANNER_RATIO_INVALID' })
    expect(res.body.message).toMatch(/5:2 ratio.*1200 × 675/)
  })

  it('rejects a 4:5 portrait image', async () => {
    expect((await createCommunityReq(await image('communities', 800, 1000))).body.code).toBe('BANNER_RATIO_INVALID')
  })

  it('rejects a GIF, a file that is not an image, and one that was never uploaded', async () => {
    expect((await createCommunityReq(await image('communities', 1000, 400, 'gif'))).status).toBe(400)
    const junk = 'http://storage.test/bucket/communities/junk.jpg'
    stored.set(junk, Buffer.from('not an image'))
    expect((await createCommunityReq(junk)).status).toBe(400)
    expect((await createCommunityReq('https://example.com/cover.jpg')).body.code).toBe('BANNER_IMAGE_INVALID')
  })

  it('allows no cover image at all', async () => {
    expect((await createCommunityReq()).status).toBe(201)
  })

  it('checks a new cover on update, but not an unchanged old one', async () => {
    const oldCover = 'http://storage.test/bucket/communities/legacy.jpg' // predates the rule, never readable here
    const c = await prisma.community.create({ data: { createdBy: admin.id, name: 'Old', slug: 'old', coverImageUrl: oldCover, tags: [] } })
    const patch = (body: object) => request(app).patch(`/api/v1/admin/communities/${c.id}`).set('Authorization', admin.auth).send(body)

    expect((await patch({ name: 'Old, renamed', coverImageUrl: oldCover })).status).toBe(200)
    expect((await patch({ name: 'Old', coverImageUrl: await image('communities', 1200, 675) })).status).toBe(400)
    expect((await patch({ name: 'Old', coverImageUrl: await image('communities', 1500, 600) })).status).toBe(200)
  })
})

describe('service thumbnail', () => {
  const create = (body: object) => request(app).post('/api/v1/admin/services/catalog').set('Authorization', admin.auth).send(body)

  it('accepts 5:2 and rejects 16:9', async () => {
    expect((await create(serviceBody(await image('services', 1500, 600)))).status).toBe(201)
    const bad = await create(serviceBody(await image('services', 1200, 675)))
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('BANNER_RATIO_INVALID')
    expect(bad.body.message).toMatch(/thumbnail image/)
  })

  it('checks a new thumbnail on update, but not an unchanged old one', async () => {
    const good = await create(serviceBody(await image('services', 1500, 600)))
    const id = good.body.data.id as string
    const patch = (body: object) => request(app).patch(`/api/v1/admin/services/catalog/${id}`).set('Authorization', admin.auth).send(body)
    const current = good.body.data
    const full = { title: current.title, name: current.name, description: current.description, iconUrl: null, serviceType: 'expert_advisory', tags: [], highlights: [], whatMembersGet: [], isActive: true }

    expect((await patch({ ...full, imageUrl: current.imageUrl, title: 'Renamed' })).status).toBe(200)
    expect((await patch({ ...full, imageUrl: await image('services', 800, 1000) })).status).toBe(400)
  })
})
