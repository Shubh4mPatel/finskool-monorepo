import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  BATCH_PAUSE_MS,
  DEFAULT_LOGO_REQUESTS_PER_MINUTE,
  MAX_RATE_LIMIT_RETRIES,
  RETRY_PAUSE_MS,
  createPacer,
  downloadStockLogos,
  extractDomain,
  parseCsv,
  parseNseList,
  publicUrlFor,
  rateLimitWaitMs,
  requestPaced,
  type FetchedLogo,
  type LogoDeps,
} from '../../prisma/stock-logos-core.js'
import { prisma, resetDb, createAdmin, createCommunity, daysFromNow } from '../helpers/fixtures.js'

// The one-time download of stock logos (npm run db:download-stock-logos). For every stock without a logo it looks for one
// by the company's website and then by its ISIN, keeps a copy in our storage and stores its address, and writes nothing
// else. Finedge, logo.dev and the file store are replaced by fakes here: nothing in this file calls them.

const app = createApp()

type Site = string | null | 'error'
type Logo = 'none' | 'error' | 'later'

/**
 * By default every symbol has a website (`www.<symbol>.com`) and every site has a logo. Give `isins` (symbol -> ISIN) to switch
 * on the ISIN route; an ISIN has a logo unless `isinLogos` says otherwise.
 */
function fakeDeps(opts: { websites?: Record<string, Site>; logos?: Record<string, Logo>; isins?: Record<string, string>; isinLogos?: Record<string, Logo>; failEverything?: boolean } = {}) {
  const calls = { websites: [] as string[], logos: [] as string[], isinLogos: [] as string[], stored: 0, pauses: [] as number[] }
  const laterSeen = new Set<string>()
  /** The answer for a logo lookup, with the "only just heard of it" case: nothing the first time, the logo the second. */
  const answer = (state: Logo | undefined, key: string): FetchedLogo | null => {
    if (state === 'none') return null
    if (state === 'error') throw new Error('logo.dev is having a bad day')
    if (state === 'later' && !laterSeen.has(key)) {
      laterSeen.add(key)
      return null
    }
    return { buffer: Buffer.from('png-bytes'), contentType: 'image/png' }
  }
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
      return answer(opts.logos?.[domain], `site:${domain}`)
    },
    ...(opts.isins
      ? {
          findIsin: (symbol: string) => opts.isins?.[symbol] ?? null,
          fetchLogoByIsin: async (isin: string): Promise<FetchedLogo | null> => {
            calls.isinLogos.push(isin)
            return answer(opts.isinLogos?.[isin], `isin:${isin}`)
          },
        }
      : {}),
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

    expect(result).toEqual({ considered: 1, downloaded: 1, bySource: { website: 1, isin: 0 }, noLogo: [], failed: [], stoppedEarly: false })
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

describe('the ISIN route', () => {
  const INFY = 'INE009A01021'

  it('finds the logo by ISIN when the company has no website on record', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ websites: { INFY: null }, isins: { INFY } })
    const result = await downloadStockLogos(prisma, deps)

    expect(result).toMatchObject({ considered: 1, downloaded: 1, bySource: { website: 0, isin: 1 }, noLogo: [], failed: [] })
    expect(calls.logos).toEqual([]) // there was no website to ask about
    expect(calls.isinLogos).toEqual([INFY])
    expect((await reload('INFY')).logoUrl).not.toBeNull()
  })

  it('is tried when the website has no logo at logo.dev, and finds it on the first pass', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ logos: { 'infy.com': 'none' }, isins: { INFY } })
    const result = await downloadStockLogos(prisma, deps)

    expect(result.bySource).toEqual({ website: 0, isin: 1 })
    expect(calls.logos).toEqual(['infy.com']) // no second look needed: the ISIN had it
    expect(calls.pauses).not.toContain(RETRY_PAUSE_MS)
  })

  it('is left alone when the website route already worked', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ isins: { INFY } })
    const result = await downloadStockLogos(prisma, deps)
    expect(result.bySource).toEqual({ website: 1, isin: 0 })
    expect(calls.isinLogos).toEqual([])
  })

  it('a company with neither a website nor a known ISIN is reported, and nobody is asked for a logo', async () => {
    await stock('MYSTERY')
    const { deps, calls } = fakeDeps({ websites: { MYSTERY: null }, isins: { OTHER: 'INE000A01011' } })
    const result = await downloadStockLogos(prisma, deps)
    expect(result).toMatchObject({ downloaded: 0, noLogo: ['MYSTERY'] })
    expect(calls.logos).toEqual([])
    expect(calls.isinLogos).toEqual([])
  })

  it('an ISIN logo.dev has no logo for is reported after a second look', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ websites: { INFY: null }, isins: { INFY }, isinLogos: { [INFY]: 'none' } })
    const result = await downloadStockLogos(prisma, deps)
    expect(result).toMatchObject({ downloaded: 0, noLogo: ['INFY'], failed: [] })
    expect(calls.isinLogos).toEqual([INFY, INFY])
    expect(calls.pauses).toContain(RETRY_PAUSE_MS)
  })

  it('an ISIN logo.dev has only just heard of gets its second look, and the logo is kept', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ websites: { INFY: null }, isins: { INFY }, isinLogos: { [INFY]: 'later' } })
    const result = await downloadStockLogos(prisma, deps)
    expect(result).toMatchObject({ downloaded: 1, bySource: { website: 0, isin: 1 }, noLogo: [] })
    expect(calls.isinLogos).toEqual([INFY, INFY])
  })

  it('an error from the ISIN lookup is a failure to retry, not "no logo"', async () => {
    await stock('INFY')
    const { deps } = fakeDeps({ websites: { INFY: null }, isins: { INFY }, isinLogos: { [INFY]: 'error' } })
    expect(await downloadStockLogos(prisma, deps)).toMatchObject({ downloaded: 0, noLogo: [], failed: ['INFY'] })
  })

  it('counts what each route found', async () => {
    await stock('AAA') // has a website with a logo
    await stock('BBB') // no website, but an ISIN with a logo
    await stock('CCC') // neither
    await stock('DDD') // a website with no logo, and an ISIN with one
    const { deps } = fakeDeps({
      websites: { BBB: null, CCC: null },
      logos: { 'ddd.com': 'none' },
      isins: { BBB: 'INE111A01011', DDD: 'INE222A01011' },
    })
    const result = await downloadStockLogos(prisma, deps)
    expect(result).toMatchObject({ considered: 4, downloaded: 3, bySource: { website: 1, isin: 2 }, noLogo: ['CCC'], failed: [] })
  })

  it('without the ISIN steps only the website route is used', async () => {
    await stock('INFY')
    const { deps, calls } = fakeDeps({ websites: { INFY: null } })
    expect(deps.findIsin).toBeUndefined()
    expect(await downloadStockLogos(prisma, deps)).toMatchObject({ downloaded: 0, noLogo: ['INFY'] })
    expect(calls.isinLogos).toEqual([])
  })
})

describe('limiting a run to one exchange', () => {
  it('--exchange looks only at stocks on that exchange', async () => {
    await stock('AAA', { exchange: 'nse' })
    await stock('BBB', { exchange: 'bse' })
    await stock('CCC', { exchange: 'nse' })
    const { deps, calls } = fakeDeps()
    const result = await downloadStockLogos(prisma, deps, { exchange: 'nse' })
    expect(result.considered).toBe(2)
    expect(calls.websites).toEqual(['AAA', 'CCC'])
    expect((await reload('BBB')).logoUrl).toBeNull()
  })
})

describe('NSE\'s list of companies', () => {
  const LIST = [
    'SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE',
    'TATASTEEL,Tata Steel Limited,EQ,18-NOV-1998,1,1,INE081A01020,1',
    '"M&M","Mahindra & Mahindra Limited",EQ,03-JAN-1996,5,1,INE101A01026,5',
    'ODDCO,"Odd, Co ""Quoted"" Limited",EQ,01-JAN-2000,10,1,INE000A01011,10',
    'BADISIN,Bad Co Limited,EQ,01-JAN-2000,10,1,NOTANISIN,10',
    'noisin,No Isin Limited,EQ,01-JAN-2000,10,1,,10',
    '',
  ].join('\r\n')

  it('maps each symbol to its company name and ISIN, reading the padded headings and quoted names', () => {
    const list = parseNseList(LIST)
    expect([...list.keys()]).toEqual(['TATASTEEL', 'M&M', 'ODDCO'])
    expect(list.get('TATASTEEL')).toEqual({ name: 'Tata Steel Limited', isin: 'INE081A01020' })
    expect(list.get('M&M')).toEqual({ name: 'Mahindra & Mahindra Limited', isin: 'INE101A01026' })
    expect(list.get('ODDCO')).toEqual({ name: 'Odd, Co "Quoted" Limited', isin: 'INE000A01011' })
  })

  it('skips a row whose ISIN is missing or not an ISIN, rather than passing a bad one on to logo.dev', () => {
    const list = parseNseList(LIST)
    expect(list.has('BADISIN')).toBe(false)
    expect(list.has('NOISIN')).toBe(false)
  })

  it('upper-cases symbols, keeps the first of a repeated symbol, and ignores a leading byte-order mark', () => {
    const list = parseNseList('﻿SYMBOL,ISIN NUMBER\nabc,INE111A01011\nABC,INE222A01011\n')
    expect(list.get('ABC')).toEqual({ name: '', isin: 'INE111A01011' }) // no name column is fine
  })

  it('refuses something that is not the list, such as an error page, so it is noticed', () => {
    expect(() => parseNseList('<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>')).toThrow(/not in the expected format/)
    expect(() => parseNseList('')).toThrow(/not in the expected format/)
  })
})

describe('reading CSV', () => {
  it('handles quotes, commas and line breaks inside a field, both line endings, and a missing final newline', () => {
    expect(parseCsv('a,"b,c","say ""hi""","line\nbreak"\r\n1,2,3,4')).toEqual([
      ['a', 'b,c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ])
  })

  it('skips blank lines but keeps a row whose only field is empty between commas', () => {
    expect(parseCsv('a,b\n\n,\n')).toEqual([['a', 'b'], ['', '']])
  })
})

describe('exchange test symbols', () => {
  it('are left out of a run: they are listed as stocks but are not companies', async () => {
    await stock('011NSETEST')
    await stock('11NSETEST')
    await stock('REALCO')
    const { deps, calls } = fakeDeps()
    const result = await downloadStockLogos(prisma, deps)
    expect(result.considered).toBe(1)
    expect(calls.websites).toEqual(['REALCO'])
    expect((await reload('011NSETEST')).logoUrl).toBeNull()
  })

  it('are looked up when asked for by name', async () => {
    await stock('011NSETEST')
    const { deps, calls } = fakeDeps()
    await downloadStockLogos(prisma, deps, { symbols: ['011NSETEST'] })
    expect(calls.websites).toEqual(['011NSETEST'])
  })
})

// logo.dev's free plan limits requests per minute and answers 429 beyond it, so the command spaces its requests out and, when
// it is told to slow down anyway, waits and tries again. These cover the pieces of that which do not need the network.
describe('how long to wait after logo.dev says to slow down', () => {
  it('waits as long as logo.dev says, in seconds, up to two minutes', () => {
    expect(rateLimitWaitMs(0, '7')).toBe(7000)
    expect(rateLimitWaitMs(3, '45')).toBe(45_000)
    expect(rateLimitWaitMs(0, '600')).toBe(120_000)
  })

  it('doubles the wait, up to a minute, when it does not say', () => {
    expect([0, 1, 2, 3, 4].map(attempt => rateLimitWaitMs(attempt, null))).toEqual([15_000, 30_000, 60_000, 60_000, 60_000])
  })

  it('does not trust a header it cannot read as a number of seconds', () => {
    for (const junk of ['', 'soon', '0', '-5', 'Wed, 21 Oct 2026 07:28:00 GMT']) expect(rateLimitWaitMs(1, junk)).toBe(30_000)
  })
})

describe('spacing the requests out', () => {
  /** A clock the test moves by hand: sleeping moves it on by that long. */
  function clock() {
    const t = { now: 0, sleeps: [] as number[], onSleep: (_ms: number) => {} }
    const sleep = async (ms: number) => {
      t.sleeps.push(ms)
      t.now += ms
      t.onSleep(ms)
    }
    return { t, sleep, read: () => t.now }
  }

  it('lets one request start every interval, however many are waiting', async () => {
    const c = clock()
    const pacer = createPacer({ minIntervalMs: 750, sleep: c.sleep, now: c.read })
    await Promise.all(Array.from({ length: 4 }, () => pacer.wait()))
    // The first starts at once; each of the other three waits one more interval than the one before: 3 x 750 in all.
    expect(c.t.sleeps).toEqual([750, 750, 750])
    expect(c.read()).toBe(2250)
  })

  it('does not hold up a request that arrives after a quiet spell', async () => {
    const c = clock()
    const pacer = createPacer({ minIntervalMs: 750, sleep: c.sleep, now: c.read })
    await pacer.wait()
    c.t.now = 10_000 // nothing for a while
    await pacer.wait()
    expect(c.t.sleeps).toEqual([]) // neither had to wait
  })

  it('holds everyone back when told to, for the time given', async () => {
    const c = clock()
    const pacer = createPacer({ minIntervalMs: 750, sleep: c.sleep, now: c.read })
    pacer.holdOff(30_000)
    await pacer.wait()
    expect(c.read()).toBe(30_000)
    await pacer.wait()
    expect(c.read()).toBe(30_750) // and then back to the normal spacing
  })

  it('a hold-off set while a request is already waiting its turn still holds that request back', async () => {
    const c = clock()
    const pacer = createPacer({ minIntervalMs: 750, sleep: c.sleep, now: c.read })
    await pacer.wait() // takes the first slot
    c.t.onSleep = ms => { if (ms === 750) pacer.holdOff(5_000) } // a 429 arrives while the next one sleeps
    await pacer.wait()
    expect(c.t.sleeps).toEqual([750, 5_000]) // woke at 750, found the hold-off, and waited that out too
    expect(c.read()).toBe(5_750)
  })

  it('a longer hold-off is never shortened by a shorter one', async () => {
    const c = clock()
    const pacer = createPacer({ minIntervalMs: 100, sleep: c.sleep, now: c.read })
    pacer.holdOff(60_000)
    pacer.holdOff(5_000)
    await pacer.wait()
    expect(c.read()).toBe(60_000)
  })

  it('the default pace keeps well under a hundred requests a minute', () => {
    expect(DEFAULT_LOGO_REQUESTS_PER_MINUTE).toBeLessThan(100)
    expect(Math.ceil(60_000 / DEFAULT_LOGO_REQUESTS_PER_MINUTE) * DEFAULT_LOGO_REQUESTS_PER_MINUTE).toBeGreaterThanOrEqual(60_000)
  })
})

describe('sending a request when logo.dev may say to slow down', () => {
  /** A hand-moved clock and the pacer on it, plus a request that answers from a script, one answer per send. */
  function setup(script: { status: number; retryAfter?: string }[], minIntervalMs = 750) {
    let now = 0
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
      now += ms
    }
    const pacer = createPacer({ minIntervalMs, sleep, now: () => now })
    const logged: string[] = []
    let sent = 0
    const send = async () => {
      const answer = script[Math.min(sent, script.length - 1)]!
      sent++
      return { status: answer.status, headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? (answer.retryAfter ?? null) : null) } }
    }
    return { run: () => requestPaced(send, pacer, line => logged.push(line)), logged, sleeps, sent: () => sent, clock: () => now }
  }

  it('hands a good answer straight back, having waited only its turn', async () => {
    const t = setup([{ status: 200 }])
    expect((await t.run()).status).toBe(200)
    expect(t.sent()).toBe(1)
    expect(t.logged).toEqual([])
  })

  it('waits out a 429 and sends the request again, and says so', async () => {
    const t = setup([{ status: 429 }, { status: 200 }])
    expect((await t.run()).status).toBe(200)
    expect(t.sent()).toBe(2)
    expect(t.logged).toEqual(['logo.dev asked us to slow down: waiting 15s'])
    expect(t.clock()).toBeGreaterThanOrEqual(15_000) // it really did hold off that long
  })

  it('waits as long as logo.dev said when it sends a Retry-After', async () => {
    const t = setup([{ status: 429, retryAfter: '9' }, { status: 200 }])
    await t.run()
    expect(t.logged).toEqual(['logo.dev asked us to slow down: waiting 9s'])
    expect(t.clock()).toBeGreaterThanOrEqual(9_000)
  })

  it('waits longer each time it is told again', async () => {
    const t = setup([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 200 }])
    await t.run()
    expect(t.logged).toEqual([
      'logo.dev asked us to slow down: waiting 15s',
      'logo.dev asked us to slow down: waiting 30s',
      'logo.dev asked us to slow down: waiting 60s',
    ])
  })

  it('gives up when it is still being told to slow down after the allowed retries, so the stock counts as failed', async () => {
    const t = setup([{ status: 429 }])
    await expect(t.run()).rejects.toThrow(/429 Too Many Requests, still after waiting/)
    expect(t.sent()).toBe(MAX_RATE_LIMIT_RETRIES + 1)
  })

  it('hands back any other answer, good or bad, for the caller to read', async () => {
    for (const status of [202, 404, 500]) expect((await setup([{ status }]).run()).status).toBe(status)
  })

  it('a 429 for one request holds the next request back too, not only itself', async () => {
    const t = setup([{ status: 429 }, { status: 200 }, { status: 200 }])
    await t.run() // told to slow down, waits 15s, then succeeds
    const before = t.clock()
    await t.run() // the next request is simply spaced after it
    expect(t.clock() - before).toBeLessThanOrEqual(750)
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
