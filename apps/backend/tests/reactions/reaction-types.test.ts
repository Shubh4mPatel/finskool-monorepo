import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { REACTION_TYPES, syncReactionTypes } from '../../prisma/reaction-types.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestMobileMember } from '../helpers/fixtures.js'

// The reaction types are now Like, Love, Insightful, Haha and Celebrate. Deployed databases still hold the old six
// (Like, Love, Haha, Wow, Sad, Angry), so these tests start from that state and check what the migration and the
// seed script do to real reactions and to the counts stored on posts.

const app = createApp()
const MIGRATION = readFileSync(new URL('../../prisma/migrations/20261105100000_reaction_types_v2/migration.sql', import.meta.url), 'utf8')

const OLD_TYPES = [
  { id: 1, name: 'like', emoji: '👍', sortOrder: 1 },
  { id: 2, name: 'love', emoji: '❤️', sortOrder: 2 },
  { id: 3, name: 'haha', emoji: '😂', sortOrder: 3 },
  { id: 4, name: 'wow', emoji: '😮', sortOrder: 4 },
  { id: 5, name: 'sad', emoji: '😢', sortOrder: 5 },
  { id: 6, name: 'angry', emoji: '😡', sortOrder: 6 },
]

let admin: { id: string }
let community: { id: string }
let members: TestMobileMember[]
let postA: { id: string }
let postB: { id: string }

const typesNow = async () => (await prisma.reactionType.findMany({ orderBy: { sortOrder: 'asc' } })).map(t => ({ id: t.id, name: t.name, emoji: t.emoji, sortOrder: t.sortOrder }))
const countsOf = async (postId: string) => (await prisma.post.findUniqueOrThrow({ where: { id: postId } })).reactionCounts

async function react(member: TestMobileMember, postId: string, reactionTypeId: number) {
  return request(app).put(`/api/v1/mobile/posts/${postId}/reactions`).set('Cookie', mobileCookie(member)).send({ reactionTypeId })
}

/** The state of a database that has not been migrated yet: six types, and reactions of every kind on two posts. */
async function seedOldWorld() {
  await prisma.reaction.deleteMany()
  await prisma.reactionType.deleteMany()
  await prisma.reactionType.createMany({ data: OLD_TYPES })
  // postA: like, love, haha, wow, sad, angry, one each. postB: two likes and one wow.
  const spec: [number, string, number][] = [[0, 'A', 1], [1, 'A', 2], [2, 'A', 3], [3, 'A', 4], [4, 'A', 5], [5, 'A', 6], [0, 'B', 1], [1, 'B', 1], [2, 'B', 4]]
  for (const [m, which, typeId] of spec) {
    await prisma.reaction.create({ data: { postId: which === 'A' ? postA.id : postB.id, userId: members[m]!.id, reactionTypeId: typeId } })
  }
  await prisma.post.update({ where: { id: postA.id }, data: { reactionCounts: { like: 1, love: 1, haha: 1, wow: 1, sad: 1, angry: 1 } } })
  await prisma.post.update({ where: { id: postB.id }, data: { reactionCounts: { like: 2, wow: 1 } } })
}

beforeEach(async () => {
  await resetDb()
  admin = await createAdmin()
  community = await createCommunity(admin.id)
  members = []
  for (let i = 0; i < 6; i++) members.push(await createMobileMember({ subscriptions: [{ communityId: community.id, validUntil: daysFromNow(60) }] }))
  const mk = (title: string) => prisma.post.create({ data: { communityId: community.id, authorId: admin.id, title, contentMd: 'body', status: 'published', publishedAt: new Date() } })
  postA = await mk('Post A')
  postB = await mk('Post B')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('the new list', () => {
  it('is Like, Love, Insightful, Haha, Celebrate, in that order', () => {
    expect(REACTION_TYPES.map(t => t.name)).toEqual(['like', 'love', 'insightful', 'haha', 'celebrate'])
    expect(REACTION_TYPES.map(t => t.sortOrder)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the old ids of Like, Love and Haha, and gives the new types new ids', () => {
    const idOf = Object.fromEntries(REACTION_TYPES.map(t => [t.name, t.id]))
    expect(idOf).toEqual({ like: 1, love: 2, haha: 3, insightful: 7, celebrate: 8 })
  })
})

describe.each([
  ['the migration SQL', async () => { await prisma.$executeRawUnsafe(MIGRATION) }],
  ['the seed script (syncReactionTypes)', async () => { await syncReactionTypes(prisma) }],
])('%s, run on a database with the old six types', (_name, run) => {
  it('ends with exactly the five types, with the right emoji and order', async () => {
    await seedOldWorld()
    await run()
    expect(await typesNow()).toEqual(REACTION_TYPES.map(t => ({ ...t })))
  })

  it('deletes the Wow, Sad and Angry reactions and keeps every Like, Love and Haha', async () => {
    await seedOldWorld()
    await run()
    const left = await prisma.reaction.findMany({ select: { postId: true, userId: true, reactionTypeId: true } })
    expect(left.map(r => r.reactionTypeId).sort()).toEqual([1, 1, 1, 2, 3])
    expect(left.filter(r => r.postId === postA.id)).toHaveLength(3)
    expect(left.filter(r => r.postId === postB.id)).toHaveLength(2)
  })

  it('rebuilds the count stored on each post', async () => {
    await seedOldWorld()
    await run()
    expect(await countsOf(postA.id)).toEqual({ like: 1, love: 1, haha: 1 })
    expect(await countsOf(postB.id)).toEqual({ like: 2 })
  })

  it('leaves a post with nothing but removed reactions with an empty summary, not a stale one', async () => {
    await seedOldWorld()
    await prisma.reaction.deleteMany({ where: { postId: postB.id, reactionTypeId: 1 } })
    await prisma.post.update({ where: { id: postB.id }, data: { reactionCounts: { wow: 1 } } })
    await run()
    expect(await countsOf(postB.id)).toEqual({})
  })

  it('does not touch posts whose counts never mentioned a removed type', async () => {
    await seedOldWorld()
    const other = await prisma.post.create({ data: { communityId: community.id, authorId: admin.id, title: 'Quiet', contentMd: 'b', status: 'published', publishedAt: new Date(), reactionCounts: { like: 7 } } })
    await run()
    expect(await countsOf(other.id)).toEqual({ like: 7 })
  })

  it('is safe to run again: the second run changes nothing', async () => {
    await seedOldWorld()
    await run()
    const types = await typesNow()
    const reactions = await prisma.reaction.count()
    const counts = [await countsOf(postA.id), await countsOf(postB.id)]
    await run()
    expect(await typesNow()).toEqual(types)
    expect(await prisma.reaction.count()).toBe(reactions)
    expect([await countsOf(postA.id), await countsOf(postB.id)]).toEqual(counts)
  })

  it('works on an empty database too (a fresh install)', async () => {
    await prisma.reactionType.deleteMany()
    await run()
    expect(await typesNow()).toEqual(REACTION_TYPES.map(t => ({ ...t })))
  })
})

describe('after the change, through the API', () => {
  beforeEach(async () => {
    await seedOldWorld()
    await syncReactionTypes(prisma)
  })

  it('GET /mobile/reaction-types lists the five, in display order', async () => {
    const res = await request(app).get('/api/v1/mobile/reaction-types').set('Cookie', mobileCookie(members[0]!))
    expect(res.status).toBe(200)
    expect(res.body.data.map((t: { name: string }) => t.name)).toEqual(['like', 'love', 'insightful', 'haha', 'celebrate'])
    expect(res.body.data[2]).toMatchObject({ id: 7, emoji: '💡' })
    expect(res.body.data[4]).toMatchObject({ id: 8, emoji: '👏' })
  })

  it('a member can react with Insightful and Celebrate, and the post count shows them', async () => {
    const fresh = await prisma.post.create({ data: { communityId: community.id, authorId: admin.id, title: 'Fresh', contentMd: 'b', status: 'published', publishedAt: new Date() } })
    expect((await react(members[0]!, fresh.id, 7)).status).toBe(200)
    const second = await react(members[1]!, fresh.id, 8)
    expect(second.status).toBe(200)
    expect(second.body.data.reactionCounts).toEqual({ insightful: 1, celebrate: 1 })
    expect(await countsOf(fresh.id)).toEqual({ insightful: 1, celebrate: 1 })
  })

  it('changing a reaction from Like to Insightful moves the count', async () => {
    const fresh = await prisma.post.create({ data: { communityId: community.id, authorId: admin.id, title: 'Switch', contentMd: 'b', status: 'published', publishedAt: new Date() } })
    await react(members[0]!, fresh.id, 1)
    const res = await react(members[0]!, fresh.id, 7)
    expect(res.body.data).toMatchObject({ reactionCounts: { insightful: 1 }, myReaction: 'insightful' })
  })

  it.each([4, 5, 6, 9])('an app that still sends reaction type %i is told it is invalid (400) and nothing is saved', async id => {
    const before = await prisma.reaction.count()
    const res = await react(members[3]!, postB.id, id)
    expect(res.status).toBe(400)
    expect(await prisma.reaction.count()).toBe(before)
  })

  it('the reactors list shows the new type names', async () => {
    const fresh = await prisma.post.create({ data: { communityId: community.id, authorId: admin.id, title: 'List', contentMd: 'b', status: 'published', publishedAt: new Date() } })
    await react(members[0]!, fresh.id, 8)
    const boss = await createAdmin()
    const res = await request(app).get(`/api/v1/posts/${fresh.id}/reactions`).set('Authorization', boss.auth)
    expect(res.status).toBe(200)
    expect(res.body.data.reactions[0]).toMatchObject({ reactionType: 'celebrate', emoji: '👏' })
  })
})
