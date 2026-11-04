import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  BATCH_PAUSE_MS,
  RETRY_PAUSE_MS,
  downloadStockLogos,
  extractDomain,
  publicUrlFor,
  type FetchedLogo,
  type LogoDeps,
} from '../../prisma/stock-logos-core.js'
import { prisma, resetDb, createAdmin, createCommunity, daysFromNow } from '../helpers/fixtures.js'

// The one-time download of stock logos (npm run db:download-stock-logos). For every stock without a logo it finds the
// company's website, fetches the logo for it, keeps a copy in our storage and stores its address, and writes nothing else.
// Finedge, logo.dev and the file store are replaced by fakes here: nothing in this file calls them.

const app = createApp()

type Site = string | null | 'error'
type Logo = 'none' | 'error' | 'later'

/** By default every symbol has a website (`www.<symbol>.com`) and every site has a logo. */
function fakeDeps(opts: { websites?: Record<string, Site>; logos?: Record<string, Logo>; failEverything?: boolean } = {}) {
  const calls = { websites: [] as string[], logos: [] as string[], stored: 0, pauses: [] as number[] }
  const laterSeen = new Set<string>()
  const deps: LogoDeps = {
    async findWebsite(symbol) {
      calls.websites.push(symbol)
      if (opts.failEverything) throw new Error('Finedge is having a bad day')
      const w = opts.websites?.[symbol]
      if (w === 'error') throw new Error('Finedge is having a bad day')
      return w === undefined ? `https://www.${symbol.toLowerCase()}.com/about` : w
    },
    async fetchLogo(domain): Promise<FetchedLogo | null> {
      calls.logos.push(domain)
      const l = opts.logos?.[domain]
      if (l === 'none') return null
      if (l === 'error') throw new Error('logo.dev is having a bad day')
      if (l === 'later') {
        // logo.dev has only just heard of this domain: nothing the first time, the logo the second.
        if (!laterSeen.has(domain)) {
          laterSeen.add(domain)
          return null
        }
      }
      return { buffer: Buffer.from('png-bytes'), contentType: 'image/png' }
    },
    async storeLogo() {
      calls.stored += 1
      return `https://files.test/assets/finskool/stock-logos/${calls.stored}.png`
    },
    async pause(ms) {
      calls.pauses.push(ms)
    },
  }
  return { deps, calls }
}

const stock = (symbol: string, over: Record<string, unknown> = {}) =>
  prisma.stock.create({ data: { symbol, name: `${symbol} Limited`, ...over } as never })
const reload = (symbol: string) => prisma.stock.findUniqueOrThrow({ where: { symbol } })

beforeEach(async () => {
  await resetDb()
  await prisma.stock.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('downloading a stock\'s logo', () => {
  it('stores the logo\'s address on the stock and changes nothing else about it', async () => {
    await stock('RELIANCE', { sector: null, cmp: 2850.5, closePrice: 2849, token: '2885', exchange: 'nse' })
    const before = await reload('RELIANCE')
    const { deps, calls } = fakeDeps()
    const result = await downloadStockLogos(prisma, deps)

    expect(result).toEqual({ considered: 1, downloaded: 1, noLogo: [], failed: [], stoppedEarly: false })
    const after = await reload('RELIANCE')
    expect(after.logoUrl).toBe('https://files.test/assets/finskool/stock-logos/1.png')
    // Only the logo moved. Name, symbol, sector, prices, token and exchange are as they were.
    expect({ ...after, logoUrl: null, updatedAt: null }).toEqual({ ...before, logoUrl: null, updatedAt: null })
    // The company's website, without the scheme, "www." or path, is what logo.dev is asked for.
    expect(calls.logos).toEqual(['reliance.com'])
  })

  it('leaves alone a stock that has a logo, and one that is switched off', async () => {
    await stock('HAVELOGO', { logoUrl: 'https://files.test/already.png' })
    await stock('SWITCHEDOFF', { isActive: false })
    await stock('NEEDSONE')
    const { deps, calls } = fakeDeps()
    await downloadStockLogos(prisma, deps)

    expect(calls.websites).toEqual(['NEEDSONE'])
    expect((await reload('HAVELOGO')).logoUrl).toBe('https://files.test/already.png')
    expect((await reload('SWITCHEDOFF')).logoUrl).toBeNull()
  })

  it('does nothing, and asks nobody, when every stock has a logo; and a second run after a full one is the same', async () => {
    await stock('A1')
    await stock('B1')
    await downloadStockLogos(prisma, fakeDeps().deps)
    const again = fakeDeps()
    expect(await downloadStockLogos(prisma, again.deps)).toMatchObject({ considered: 0, downloaded: 0 })
    expect(again.calls.websites).toEqual([])
  })

  it('works through the list alphabetically, five at a time, pausing between batches', async () => {
    for (let i = 0; i < 12; i++) await stock(`S${String(i).padStart(2, '0')}`)
    const { deps, calls } = fakeDeps()
    const result = await downloadStockLogos(prisma, deps)
    expect(result.downloaded).toBe(12)
    expect(calls.websites).toEqual(Array.from({ length: 12 }, (_, i) => `S${String(i).padStart(2, '0')}`))
    expect(calls.pauses).toEqual([BATCH_PAUSE_MS, BATCH_PAUSE_MS]) // between batches 1-2 and 2-3, not after the last
  })
})

describe('a trial run', () => {
  it('--limit looks at only that many', async () => {
    for (const s of ['AAA', 'BBB', 'CCC', 'DDD']) await stock(s)
    const result = await downloadStockLogos(prisma, fakeDeps().deps, { limit: 2 })
    expect(result.considered).toBe(2)
    expect((await reload('AAA')).logoUrl).not.toBeNull()
    expect((await reload('BBB')).logoUrl).not.toBeNull()
    expect((await reload('CCC')).logoUrl).toBeNull()
  })

  it('--symbols looks at only those, in any case', async () => {
    for (const s of ['AAA', 'BBB', 'CCC']) await stock(s)
    const { deps, calls } = fakeDeps()
    await downloadStockLogos(prisma, deps, { symbols: ['ccc', ' AAA '] })
    expect(calls.websites).toEqual(['AAA', 'CCC'])
    expect((await reload('BBB')).logoUrl).toBeNull()
  })
})

describe('a stock with no logo to be had', () => {
  it.each([
    ['has no website on record', { INFY: null }, {}],
    ['has a website but logo.dev has no logo for it', {}, { 'infy.com': 'none' as const }],
  ])('one that %s is reported, and keeps no logo', async (_why, websites, logos) => {
    await stock('INFY')
    await stock('TCS')
    const result = await downloadStockLogos(prisma, fakeDeps({ websites, logos }).deps)
    expect(result).toMatchObject({ considered: 2, downloaded: 1, noLogo: ['INFY'], failed: [] })
    expect((await reload('INFY')).logoUrl).toBeNull()
    expect((await reload('TCS')).logoUrl).not.toBeNull()
  })

  it('a site logo.dev has only just heard of gets a second look after a pause, and its logo is kept', async () => {
    await stock('NEWCO')
    await stock('OLDCO')
    const { deps, calls } = fakeDeps({ logos: { 'newco.com': 'later' } })
    const result = await downloadStockLogos(prisma, deps)

    expect(result).toMatchObject({ downloaded: 2, noLogo: [], failed: [] })
    expect(calls.logos.filter(d => d === 'newco.com')).toHaveLength(2) // asked twice
    expect(calls.pauses).toContain(RETRY_PAUSE_MS)
    expect((await reload('NEWCO')).logoUrl).not.toBeNull()
  })

  it('a site that still has nothing on the second look is reported, not retried again', async () => {
    await stock('GHOST')
    const { deps, calls } = fakeDeps({ logos: { 'ghost.com': 'none' } })
    const result = await downloadStockLogos(prisma, deps)
    expect(result.noLogo).toEqual(['GHOST'])
    expect(calls.logos).toEqual(['ghost.com', 'ghost.com'])
  })
})

describe('when an API lets us down', () => {
  it('one stock that cannot be answered does not stop the rest, and is listed to retry', async () => {
    for (const s of ['AAA', 'BAD', 'CCC', 'DDD', 'EEE']) await stock(s)
    const result = await downloadStockLogos(prisma, fakeDeps({ websites: { BAD: 'error' } }).deps)
    expect(result).toMatchObject({ considered: 5, downloaded: 4, failed: ['BAD'], stoppedEarly: false })

    // Nothing is marked: running again picks up exactly the one that failed.
    const second = fakeDeps()
    expect(await downloadStockLogos(prisma, second.deps)).toMatchObject({ considered: 1, downloaded: 1 })
    expect(second.calls.websites).toEqual(['BAD'])
  })

  it('a logo.dev error is a failure to retry, not "no logo"', async () => {
    await stock('INFY')
    const result = await downloadStockLogos(prisma, fakeDeps({ logos: { 'infy.com': 'error' } }).deps)
    expect(result).toMatchObject({ failed: ['INFY'], noLogo: [], downloaded: 0 })
  })

  it('an outage stops the run after three dead batches, and the next run carries on', async () => {
    for (let i = 0; i < 25; i++) await stock(`S${String(i).padStart(2, '0')}`)
    const down = fakeDeps({ failEverything: true })
    const result = await downloadStockLogos(prisma, down.deps)

    expect(result.stoppedEarly).toBe(true)
    expect(result.failed).toHaveLength(15) // three batches of five, then it gives up
    expect(down.calls.websites).toHaveLength(15)
    expect(await prisma.stock.count({ where: { logoUrl: { not: null } } })).toBe(0)

    // The APIs are back: every stock is done.
    expect(await downloadStockLogos(prisma, fakeDeps().deps)).toMatchObject({ considered: 25, downloaded: 25, stoppedEarly: false })
  })

  it('a stopped run can be cut short and resumed: what was done stays done', async () => {
    for (let i = 0; i < 10; i++) await stock(`S${String(i).padStart(2, '0')}`)
    await downloadStockLogos(prisma, fakeDeps().deps, { limit: 4 })
    const rest = fakeDeps()
    expect(await downloadStockLogos(prisma, rest.deps)).toMatchObject({ considered: 6, downloaded: 6 })
    expect(rest.calls.websites).not.toContain('S00')
  })
})

describe('the saved address', () => {
  it('follows the app\'s rule: behind nginx the path prefix is /assets, with MinIO reached directly it is empty', () => {
    const base = { ssl: true, host: 'community.finskool21.in', port: 443, bucket: 'finskool', objectName: 'stock-logos/a.png' }
    expect(publicUrlFor({ ...base, pathPrefix: '/assets' })).toBe('https://community.finskool21.in:443/assets/finskool/stock-logos/a.png')
    expect(publicUrlFor({ ...base, ssl: false, host: 'localhost', port: '9002', pathPrefix: '' })).toBe('http://localhost:9002/finskool/stock-logos/a.png')
  })
})

describe('the websites it is given', () => {
  it.each([
    ['https://www.tatasteel.com/investors', 'tatasteel.com'],
    ['http://ril.com', 'ril.com'],
    ['www.bls.com', 'bls.com'],
    ['HTTPS://WWW.Example.in?x=1', 'Example.in'],
    ['  https://hdfcbank.com/#top  ', 'hdfcbank.com'],
  ])('%s -> %s', (website, domain) => {
    expect(extractDomain(website)).toBe(domain)
  })
})

describe('the whole chain', () => {
  it('a trade for a stock without a logo shows it in the admin screens once the download has run', async () => {
    const boss = await createAdmin({ isSuperAdmin: true })
    const community = await createCommunity(boss.id, { name: 'Swing' })
    const board = await prisma.performanceBoard.create({ data: { communityId: community.id, kind: 'swing' } })
    await stock('BLS')
    const date = daysFromNow(-2)
    await prisma.performanceTrade.create({ data: { boardId: board.id, segment: 'main', tradeDate: new Date(date), name: 'BLS International', symbol: 'BLS', entryPrice: 262, tradeKey: `${date}|BLS` } as never })

    const trades = () => request(app).get(`/api/v1/admin/performance/communities/${community.id}/trades?pageSize=50`).set('Authorization', boss.auth)
    expect((await trades()).body.data.items[0].logoUrl).toBeNull() // nothing yet: the screen draws initials

    await downloadStockLogos(prisma, fakeDeps().deps)
    expect((await trades()).body.data.items[0].logoUrl).toBe('https://files.test/assets/finskool/stock-logos/1.png')
  })
})
