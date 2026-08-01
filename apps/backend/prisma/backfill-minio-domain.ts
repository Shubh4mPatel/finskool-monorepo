// One-off: rewrites MinIO URLs stored before the community.finskool21.in domain migration
// (old scheme: http://<ip>:<port>/<bucket>/... ; new scheme, via nginx's /assets/ proxy:
// see toPublicUrl in src/lib/minio.ts) across every column that stores an absolute MinIO
// URL. Run once against production with `npm run db:backfill-minio-domain`; safe to re-run
// (rows already on the new prefix are left untouched).
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const OLD_PREFIX = process.env['OLD_MINIO_URL_PREFIX'] ?? 'http://157.173.220.80:9002/finskool/'
const NEW_PREFIX = process.env['NEW_MINIO_URL_PREFIX'] ?? 'https://community.finskool21.in:443/assets/finskool/'

function rewrite(url: string): string {
  return url.startsWith(OLD_PREFIX) ? NEW_PREFIX + url.slice(OLD_PREFIX.length) : url
}

async function main() {
  console.log(`Rewriting "${OLD_PREFIX}" -> "${NEW_PREFIX}"`)

  const posts = await prisma.post.findMany({ where: { imageUrls: { isEmpty: false } } })
  let postsChanged = 0
  for (const post of posts) {
    const imageUrls = post.imageUrls.map(rewrite)
    if (imageUrls.some((url, i) => url !== post.imageUrls[i])) {
      await prisma.post.update({ where: { id: post.id }, data: { imageUrls } })
      postsChanged++
    }
  }
  console.log(`posts: ${postsChanged}/${posts.length} rows updated`)

  const users = await prisma.user.findMany({ where: { avatarUrl: { startsWith: OLD_PREFIX } } })
  for (const user of users) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: rewrite(user.avatarUrl!) } })
  }
  console.log(`users: ${users.length} rows updated`)

  const communitiesByCover = await prisma.community.findMany({ where: { coverImageUrl: { startsWith: OLD_PREFIX } } })
  for (const community of communitiesByCover) {
    await prisma.community.update({ where: { id: community.id }, data: { coverImageUrl: rewrite(community.coverImageUrl!) } })
  }
  console.log(`communities.coverImageUrl: ${communitiesByCover.length} rows updated`)

  const communitiesByBadge = await prisma.community.findMany({ where: { badgeUrl: { startsWith: OLD_PREFIX } } })
  for (const community of communitiesByBadge) {
    await prisma.community.update({ where: { id: community.id }, data: { badgeUrl: rewrite(community.badgeUrl!) } })
  }
  console.log(`communities.badgeUrl: ${communitiesByBadge.length} rows updated`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
