import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { createApp } from '../../src/app.js'
import { inspectImage, orientationOf, ratioOf } from '../../src/lib/media-info.js'
import { prisma, resetDb, createAdmin, createCommunity, type TestAdmin } from '../helpers/fixtures.js'

// Post media: POST /posts/media measures and stores uploads; creating/updating a post re-reads the sizes from
// storage and keeps the post's orientation and ratio (from its first sized media) in the database.

// MinIO stand-in: uploaded images are kept in memory, keyed by the URL handed back.
const stored = new Map<string, Buffer>()
const deleted: string[] = []
let seq = 0
vi.mock('../../src/lib/minio.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/minio.js')>()
  return {
    ...actual,
    uploadFile: async (buffer: Buffer, name: string) => {
      const url = `http://storage.test/bucket/posts/${++seq}.${name.split('.').pop()}`
      stored.set(url, buffer)
      return url
    },
    readOwnObject: async (url: string) => stored.get(url) ?? null,
    existingVideoPosterUrl: async () => null,
    internalReadUrl: async () => null,
    deleteFile: async (url: string) => {
      deleted.push(url)
    },
  }
})

const app = createApp()
let admin: TestAdmin
let communityId: string

const jpeg = (width: number, height: number, exifOrientation?: number) => {
  const img = sharp({ create: { width, height, channels: 3, background: '#cc3333' } }).jpeg()
  return (exifOrientation ? img.withMetadata({ orientation: exifOrientation }) : img).toBuffer()
}

const upload = (files: Array<{ buffer: Buffer; name: string }>) => {
  const req = request(app).post('/api/v1/posts/media').set('Authorization', admin.auth)
  for (const f of files) req.attach('files', f.buffer, f.name)
  return req
}

const createPost = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/posts').set('Authorization', admin.auth).send({ communityId, title: 'T', content: 'C', ...body })

beforeEach(async () => {
  await resetDb()
  stored.clear()
  deleted.length = 0
  admin = await createAdmin({ isSuperAdmin: true })
  communityId = (await createCommunity(admin.id, { name: 'Swing' })).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('inspectImage', () => {
  it('reports the displayed size, swapping width and height for a sideways EXIF photo', async () => {
    expect(await inspectImage(await jpeg(800, 400))).toMatchObject({ width: 800, height: 400, format: 'jpeg' })
    expect(await inspectImage(await jpeg(800, 400, 6))).toMatchObject({ width: 400, height: 800 })
  })

  it('refuses SVG and non-images', async () => {
    expect(await inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).toBeNull()
    expect(await inspectImage(Buffer.from('not an image'))).toBeNull()
  })

  it('calls a square landscape and rounds the ratio to 4 decimals', () => {
    expect(orientationOf({ width: 500, height: 500 })).toBe('landscape')
    expect(orientationOf({ width: 400, height: 500 })).toBe('portrait')
    expect(ratioOf({ width: 1920, height: 1080 })).toBe(1.7778)
    expect(ratioOf({ width: 400, height: 500 })).toBe(0.8)
  })
})

describe('POST /posts/media', () => {
  it('measures each image and stores it as uploaded', async () => {
    const res = await upload([
      { buffer: await jpeg(1600, 900), name: 'wide.jpg' },
      { buffer: await jpeg(800, 400, 6), name: 'phone.jpeg' },
    ])
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject([
      { kind: 'image', name: 'wide.jpg', width: 1600, height: 900, ratio: 1.7778, orientation: 'landscape' },
      { kind: 'image', name: 'phone.jpeg', width: 400, height: 800, ratio: 0.5, orientation: 'portrait' },
    ])
    expect(stored.size).toBe(2)
  })

  it('decides the type from the content, not the name', async () => {
    const res = await upload([{ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), name: 'fake.jpg' }])
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/not a valid/)
  })

  it('refuses unsupported file types and videos that are not videos', async () => {
    expect((await upload([{ buffer: Buffer.from('x'), name: 'run.exe' }])).status).toBe(400)
    expect((await upload([{ buffer: Buffer.from('not a video at all'), name: 'clip.mp4' }])).body.message).toMatch(/not a valid MP4/)
  })

  it('refuses an image over 10 MB', async () => {
    const res = await upload([{ buffer: Buffer.alloc(11 * 1024 * 1024, 1), name: 'huge.png' }])
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/at most 10 MB/)
  })

  it('stores nothing from a request where one file is refused', async () => {
    const res = await upload([
      { buffer: await jpeg(100, 100), name: 'ok.jpg' },
      { buffer: Buffer.from('nope'), name: 'bad.png' },
    ])
    expect(res.status).toBe(400)
    expect(deleted).toHaveLength(1)
  })

  it('needs an admin and at least one file', async () => {
    expect((await request(app).post('/api/v1/posts/media')).status).toBe(401)
    expect((await request(app).post('/api/v1/posts/media').set('Authorization', admin.auth)).status).toBe(400)
  })
})

describe('creating and updating posts', () => {
  async function uploaded(width: number, height: number) {
    const res = await upload([{ buffer: await jpeg(width, height), name: 'a.jpg' }])
    return res.body.data[0].url as string
  }

  it('takes the post orientation and ratio from the first image, and returns sizes for every image', async () => {
    const portrait = await uploaded(400, 800)
    const landscape = await uploaded(1600, 900)
    const res = await createPost({ imageUrls: [portrait, landscape] })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ orientation: 'portrait', ratio: 0.5, mediaWidth: 400, mediaHeight: 800 })
    expect(res.body.data.images).toMatchObject([
      { url: portrait, width: 400, height: 800, ratio: 0.5, orientation: 'portrait' },
      { url: landscape, width: 1600, height: 900, ratio: 1.7778, orientation: 'landscape' },
    ])
    const row = await prisma.post.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(row).toMatchObject({ mediaWidth: 400, mediaHeight: 800, mediaOrientation: 'portrait', mediaRatio: 0.5 })
  })

  it('ignores sizes the client sends: they come from the stored file', async () => {
    const url = await uploaded(1600, 900)
    const res = await createPost({ imageUrls: [url], images: [{ url, width: 10, height: 10 }] })
    expect(res.body.data.images[0]).toMatchObject({ width: 1600, height: 900 })
  })

  it('stores a YouTube link as it is, with no size, and gives the post no ratio', async () => {
    const res = await createPost({ videos: [{ kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Clip' }] })
    expect(res.status).toBe(201)
    expect(res.body.data.videos[0]).toMatchObject({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      width: null,
      height: null,
      ratio: null,
    })
    expect(res.body.data).toMatchObject({ ratio: null, orientation: null, mediaWidth: null })
  })

  it('uses the image for the post ratio when a link comes with it', async () => {
    const url = await uploaded(800, 1000)
    const res = await createPost({ imageUrls: [url], videos: [{ kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Clip' }] })
    expect(res.body.data).toMatchObject({ orientation: 'portrait', ratio: 0.8 })
  })

  it('refuses an image URL that is not one of our uploads', async () => {
    const res = await createPost({ imageUrls: ['https://example.com/x.jpg'] })
    expect(res.status).toBe(400)
  })

  it('fills in the size of an old post when it is saved, and keeps an old image it can no longer read', async () => {
    const readable = await uploaded(900, 1200)
    const gone = 'http://storage.test/bucket/posts/gone.jpg'
    const old = await prisma.post.create({
      data: { communityId, authorId: admin.id, title: 'Old', contentMd: 'body', status: 'published', publishedAt: new Date(), imageUrls: [gone, readable] },
    })

    const before = await request(app).get('/api/v1/posts').query({ postId: old.id }).set('Authorization', admin.auth)
    expect(before.body.data.posts[0]).toMatchObject({ ratio: null, orientation: null })
    expect(before.body.data.posts[0].images).toMatchObject([{ url: gone, width: null, ratio: null }, { url: readable, width: null }])

    const res = await request(app).patch(`/api/v1/posts/${old.id}`).set('Authorization', admin.auth).send({ title: 'Old, edited' })
    expect(res.status).toBe(200)
    expect(res.body.data.imageUrls).toEqual([gone, readable])
    expect(res.body.data.images).toMatchObject([{ url: gone, width: null }, { url: readable, width: 900, height: 1200, orientation: 'portrait' }])
    // The first image could not be read, so the post's shape comes from the first one that could.
    expect(res.body.data).toMatchObject({ orientation: 'portrait', ratio: 0.75 })
  })

  it('removes a replaced image file only when no post uses it', async () => {
    const a = await uploaded(800, 400)
    const b = await uploaded(400, 800)
    const post = await createPost({ imageUrls: [a, b] })
    await request(app).patch(`/api/v1/posts/${post.body.data.id}`).set('Authorization', admin.auth).send({ imageUrls: [b] })
    expect(deleted).toEqual([a])
  })
})
