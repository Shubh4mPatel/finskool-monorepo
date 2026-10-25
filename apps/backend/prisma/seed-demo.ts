// Demo data for development, QA and demos: communities with plans, welcome kits, posts and stock
// recommendations, a few members with subscriptions, the service catalog, and demo billing settings.
//
//   npm run db:seed:demo --workspace=apps/backend
//
// Safe to run again: everything is matched by a natural key (slug, email, title, ...) and only
// created when missing; existing rows are never duplicated. It does NOT need MinIO: images are
// public placeholder URLs (picsum.photos), so the app needs internet access to show them.
//
// It refuses to run when NODE_ENV=production, because it creates accounts with well-known
// passwords and demo billing details. Set SEED_DEMO_ALLOW_PRODUCTION=true to override on purpose.
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

if (process.env['NODE_ENV'] === 'production' && process.env['SEED_DEMO_ALLOW_PRODUCTION'] !== 'true') {
  console.error('[seed-demo] Refusing to run with NODE_ENV=production (creates demo accounts with known passwords).')
  process.exit(1)
}

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const img = (seed: string, w = 1200, h = 675) => `https://picsum.photos/seed/${seed}/${w}/${h}`
const daysFromNow = (d: number) => {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  t.setDate(t.getDate() + d)
  return t
}
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`
const priority = <T extends object>(items: T[]) => items.map((item, i) => ({ ...item, priority: i + 1 }))

const ADMIN_PASSWORD = 'Admin@123'
const MEMBER_PASSWORD = 'Member@123'

// ─── Content ────────────────────────────────────────────────────────────────

interface CommunitySeed {
  slug: string
  name: string
  type: string
  subtitle: string
  description: string
  tags: string[]
  whatsIncluded: string[]
  plans: { name: string; durationMonths: number; price: number }[]
  kit: {
    intro: string
    videos: string[]
    capital: { heroStat: string; description: string; strategyTitle: string; strategies: { value: string; label: string }[] }
    notices: { type: 'normal' | 'warning'; heading: string; description: string }[]
    whatYouGet: string[]
  }
  posts: { title: string; content: string; tags: string[]; pinned?: boolean; daysAgo: number }[]
  recommendations: { symbol: string; action: 'buy' | 'hold' | 'exit'; risk: 'low' | 'medium' | 'high'; entry: number; target: number; stop: number; notes: string }[]
}

const COMMUNITIES: CommunitySeed[] = [
  {
    slug: 'swing-alpha',
    name: 'Swing Alpha',
    type: 'Swing',
    subtitle: 'Short to medium-term trade calls with clear entries, targets and stop losses',
    description:
      'Swing Alpha shares breakout and momentum setups held for a few days to a few weeks. Every call comes with an entry zone, a target and a stop loss, plus a short note on why the setup works.',
    tags: ['Trade Alerts', 'Swing Calls', 'Live Updates'],
    whatsIncluded: ['2 to 4 swing calls every week', 'Entry, target and stop loss on every call', 'Live updates when a call is closed or revised', 'Weekly market outlook every Sunday', 'Doubt-clearing in the community chat'],
    plans: [
      { name: 'Monthly', durationMonths: 1, price: 1499 },
      { name: 'Quarterly', durationMonths: 3, price: 3999 },
      { name: 'Yearly', durationMonths: 12, price: 12999 },
    ],
    kit: {
      intro:
        'Welcome to **Swing Alpha**. Watch the short videos below before your first trade. They explain how we pick setups, how to size positions and how we exit.',
      videos: ['aqz-KE-bpKQ'],
      capital: {
        heroStat: '2% risk per trade',
        description: 'Never risk more than 2% of your capital on a single idea. The stop loss decides your position size, not the other way round.',
        strategyTitle: 'Suggested capital split',
        strategies: [
          { value: '60%', label: 'Core swing positions' },
          { value: '25%', label: 'Momentum breakouts' },
          { value: '15%', label: 'Cash for new setups' },
        ],
      },
      notices: [
        { type: 'warning', heading: 'Always use the stop loss', description: 'A call without its stop loss is not a call. Place it as soon as you enter.' },
        { type: 'normal', heading: 'Calls are updated live', description: 'If a call changes, you get a notification and a post in the community.' },
      ],
      whatYouGet: ['Swing calls with entry, target and stop loss', 'Live updates and exits', 'Weekly outlook and watchlist', 'Position-sizing worksheet'],
    },
    posts: [
      { title: 'Weekly outlook: Nifty near a key resistance', content: 'Nifty is stalling near its recent high. We stay selective this week and only take setups with a clear stop loss.\n\n**Levels to watch**\n\n- Support: the last swing low\n- Resistance: the recent high\n\nWe will post calls as they trigger.', tags: ['Outlook'], pinned: true, daysAgo: 1 },
      { title: 'How we size every swing trade', content: 'Size comes from the stop loss. If your stop is 5% away and you risk 2% of capital, your position is **40%** of capital at most.\n\nWorked example in the welcome kit.', tags: ['Education', 'Risk'], daysAgo: 4 },
      { title: 'Call closed: partial profit booked', content: 'We booked half at the first target and moved the stop to cost. The rest runs with a trailing stop.', tags: ['Update'], daysAgo: 7 },
    ],
    recommendations: [
      { symbol: 'TATASTEEL', action: 'buy', risk: 'medium', entry: 158.5, target: 175, stop: 151, notes: 'Breakout above a multi-week range on rising volume.' },
      { symbol: 'INFY', action: 'hold', risk: 'low', entry: 1640, target: 1760, stop: 1590, notes: 'Holding above the 50-day average; trail the stop.' },
      { symbol: 'ADANIPOWER', action: 'exit', risk: 'high', entry: 540, target: 610, stop: 505, notes: 'Momentum faded; exit and wait for a fresh setup.' },
    ],
  },
  {
    slug: 'investor-community',
    name: 'Investor Community',
    type: 'Long Term',
    subtitle: 'Fundamental research and portfolio building for the long run',
    description:
      'Long-term investing based on business quality, valuation and patience. We share well-researched ideas, portfolio reviews and the thinking behind every decision.',
    tags: ['Research', 'Portfolio', 'Long-term'],
    whatsIncluded: ['Monthly research report on one business', 'Quarterly portfolio review', 'Results commentary on holdings', 'Model portfolio with allocation guidance', 'Ask-me-anything session every month'],
    plans: [
      { name: 'Half yearly', durationMonths: 6, price: 4999 },
      { name: 'Yearly', durationMonths: 12, price: 8999 },
    ],
    kit: {
      intro: 'Welcome to the **Investor Community**. Start with the videos, then read the latest research report pinned in the feed.',
      videos: ['aqz-KE-bpKQ'],
      capital: {
        heroStat: '5 to 8 stocks',
        description: 'A focused portfolio of businesses you understand beats a long list you cannot follow.',
        strategyTitle: 'Model portfolio split',
        strategies: [
          { value: '50%', label: 'Compounders' },
          { value: '30%', label: 'Value and turnaround' },
          { value: '20%', label: 'Cash and debt funds' },
        ],
      },
      notices: [
        { type: 'warning', heading: 'Think in years, not weeks', description: 'These ideas are meant to be held for three to five years. Prices will swing in between.' },
        { type: 'normal', heading: 'Research is for learning', description: 'Use our work as a starting point and do your own checking before you invest.' },
      ],
      whatYouGet: ['Monthly research report', 'Quarterly portfolio review', 'Model portfolio and rebalancing notes', 'Monthly live Q&A'],
    },
    posts: [
      { title: 'Research note: why we like steady compounders', content: 'Businesses that earn high returns on capital year after year tend to reward patient owners. This month we look at the traits that matter.\n\n**What we check**\n\n1. Return on capital over ten years\n2. Debt and cash flow\n3. Management track record', tags: ['Research'], pinned: true, daysAgo: 2 },
      { title: 'Quarterly review of the model portfolio', content: 'Two holdings reported solid results and one needs watching. Full commentary and any rebalancing is in the report.', tags: ['Portfolio'], daysAgo: 9 },
    ],
    recommendations: [
      { symbol: 'ITC', action: 'buy', risk: 'low', entry: 428, target: 520, stop: 395, notes: 'Cash-rich business with improving non-cigarette segments; accumulate on dips.' },
      { symbol: 'BAJFINANCE', action: 'hold', risk: 'medium', entry: 6900, target: 8200, stop: 6200, notes: 'Strong growth; valuation is full, so no new buying here.' },
    ],
  },
  {
    slug: 'intraday-edge',
    name: 'Intraday Edge',
    type: 'Intraday',
    subtitle: 'Morning plan and live intraday setups for disciplined day traders',
    description:
      'A pre-market plan every trading day and a small number of high-quality intraday setups. Built for people who can watch the screen and follow strict risk rules.',
    tags: ['Intraday', 'Pre-market', 'Live Calls'],
    whatsIncluded: ['Pre-market plan by 8:45 AM', '1 to 3 intraday setups a day', 'Live exits and stop-loss updates', 'End-of-day review', 'Risk checklist for every trade'],
    plans: [
      { name: 'Monthly', durationMonths: 1, price: 1999 },
      { name: 'Quarterly', durationMonths: 3, price: 5499 },
    ],
    kit: {
      intro: 'Welcome to **Intraday Edge**. Intraday trading is high risk. Read the notices carefully and start small.',
      videos: [],
      capital: {
        heroStat: '1% risk per trade',
        description: 'Keep each intraday trade small. A bad day should never hurt your account.',
        strategyTitle: 'Daily loss limits',
        strategies: [
          { value: '1%', label: 'Risk per trade' },
          { value: '3%', label: 'Maximum loss in a day' },
        ],
      },
      notices: [
        { type: 'warning', heading: 'Stop for the day at your loss limit', description: 'Hit your daily loss limit and close the terminal. Revenge trading is the quickest way to lose money.' },
      ],
      whatYouGet: ['Daily pre-market plan', 'Live intraday setups', 'End-of-day review'],
    },
    posts: [
      { title: 'Pre-market plan: key levels for today', content: 'We trade only the levels below and skip the first 15 minutes.\n\n- Long above the opening range high\n- Short below the opening range low', tags: ['Plan'], pinned: true, daysAgo: 0 },
      { title: 'End-of-day review', content: 'Two setups worked, one hit the stop loss as planned. Discipline matters more than the result of one trade.', tags: ['Review'], daysAgo: 1 },
    ],
    recommendations: [{ symbol: 'WIPRO', action: 'buy', risk: 'high', entry: 262, target: 270, stop: 258, notes: 'Intraday only. Square off before 3:15 PM.' }],
  },
  {
    slug: 'dividend-income',
    name: 'Dividend Income',
    type: 'Long Term',
    subtitle: 'Build a stream of dividend income from steady businesses',
    description: 'Ideas for investors who want regular income from dividends along with slow, steady growth. We focus on payout safety and a record of paying.',
    tags: ['Dividends', 'Income', 'Stable'],
    whatsIncluded: ['Monthly dividend watchlist', 'Payout safety score for each idea', 'Dividend calendar', 'Reinvestment guide'],
    plans: [{ name: 'Yearly', durationMonths: 12, price: 5999 }],
    kit: {
      intro: 'Welcome to **Dividend Income**. A steady payout matters only if the business can keep paying, so we start with safety.',
      videos: [],
      capital: {
        heroStat: '3% to 5% yield',
        description: 'A very high yield is often a warning sign. We prefer a moderate yield that is covered by cash flow.',
        strategyTitle: 'Suggested split',
        strategies: [
          { value: '70%', label: 'Steady payers' },
          { value: '30%', label: 'Growing payers' },
        ],
      },
      notices: [{ type: 'normal', heading: 'Dividends can be cut', description: 'A company can reduce or stop its dividend. We review safety every quarter.' }],
      whatYouGet: ['Dividend watchlist', 'Payout safety scores', 'Dividend calendar'],
    },
    posts: [{ title: 'What makes a dividend safe?', content: 'Look at how much of the profit and free cash flow is paid out. A payout that is **well covered** can survive a bad year.', tags: ['Education'], pinned: true, daysAgo: 3 }],
    recommendations: [{ symbol: 'ITC', action: 'hold', risk: 'low', entry: 425, target: 500, stop: 390, notes: 'Steady payer with a long dividend record.' }],
  },
]

const STOCKS = [
  { name: 'Tata Steel Ltd', symbol: 'TATASTEEL', sector: 'Metals', token: '3499' },
  { name: 'Adani Power Ltd', symbol: 'ADANIPOWER', sector: 'Energy', token: '17388' },
  { name: 'Infosys Ltd', symbol: 'INFY', sector: 'IT', token: '1594' },
  { name: 'ITC Ltd', symbol: 'ITC', sector: 'FMCG', token: '1660' },
  { name: 'Wipro Ltd', symbol: 'WIPRO', sector: 'IT', token: '3787' },
  { name: 'Bajaj Finance Ltd', symbol: 'BAJFINANCE', sector: 'NBFC', token: '317' },
]

interface ServiceSeed {
  title: string
  serviceType: string
  description: string
  tags: string[]
  highlights: string[]
  whatMembersGet: string[]
  image: string
}

const SERVICES: ServiceSeed[] = [
  {
    title: 'Portfolio Analysis',
    serviceType: 'expert_advisory',
    description: 'Expert **stock-by-stock** review of your portfolio with clear **Hold, Sell or Add** calls, redeployment guidance and 1 year of support.',
    tags: ['portfolio', 'review', 'advisory'],
    highlights: ['For existing investors', '1 year support', '6 month review'],
    whatMembersGet: ['Stock-by-stock Hold, Sell or Add calls', 'Capital redeployment guidance', '1 year of support with a follow-up review', 'Suitable for all investor profiles'],
    image: 'finskool-portfolio-analysis',
  },
  {
    title: 'Intelligent Model Portfolio',
    serviceType: 'long_term_investment',
    description: 'An intelligent long-term model portfolio built around **quality businesses**, rebalanced when the numbers change, with regular reviews.',
    tags: ['model portfolio', 'long term', 'wealth'],
    highlights: ['Min ₹5,00,000', '2% per transaction', '2-3 years'],
    whatMembersGet: ['A model portfolio matched to your profile', 'Rebalancing alerts', 'Quarterly review call', 'Tax-aware exits'],
    image: 'finskool-model-portfolio',
  },
  {
    title: 'Wealth Planning',
    serviceType: 'wealth_planning',
    description: 'A complete plan for your goals: **retirement, children’s education and a home**. We map your income, savings and risk, then give a simple action plan.',
    tags: ['planning', 'goals', 'retirement'],
    highlights: ['Goal-based', '1-on-1 sessions'],
    whatMembersGet: ['Goal and cash-flow mapping', 'Asset allocation plan', 'Step-by-step investing roadmap', 'Yearly check-in'],
    image: 'finskool-wealth-planning',
  },
  {
    title: 'Tax Planning & Filing',
    serviceType: 'tax_compliance',
    description: 'Plan your taxes before the year ends and file returns correctly, including **capital gains** from stocks and mutual funds.',
    tags: ['tax', 'itr', 'capital gains'],
    highlights: ['Capital gains', 'ITR filing'],
    whatMembersGet: ['Capital gains statement', 'Tax-saving suggestions', 'Return filing support', 'Notice replies'],
    image: 'finskool-tax-planning',
  },
  {
    title: 'Trading Mentorship',
    serviceType: 'trading_strategy',
    description: 'Learn to trade with a **written plan and strict risk rules**. A mentor reviews your trades and helps you fix habits that cost money.',
    tags: ['mentorship', 'trading', 'risk'],
    highlights: ['8 weeks', 'Weekly trade review'],
    whatMembersGet: ['Personalised trading plan', 'Weekly trade journal review', 'Risk-management coaching', 'Private chat support'],
    image: 'finskool-trading-mentorship',
  },
  {
    title: 'Retirement Income Plan',
    serviceType: 'portfolio_management',
    description: 'Turn your savings into a **dependable monthly income** that lasts, with a safe withdrawal plan and inflation in mind.',
    tags: ['retirement', 'income'],
    highlights: ['Monthly income', 'Inflation-aware'],
    whatMembersGet: ['Safe withdrawal plan', 'Income-focused allocation', 'Yearly review'],
    image: 'finskool-retirement-income',
  },
]

// ─── Seeding ────────────────────────────────────────────────────────────────

async function upsertUser(args: { email: string; name: string; phone: string; password: string; role: 'admin' | 'member'; isSuperAdmin?: boolean }) {
  const passwordHash = await bcrypt.hash(args.password, 10)
  return prisma.user.upsert({
    where: { email: args.email },
    update: {},
    create: { name: args.name, email: args.email, phone: args.phone, passwordHash, role: args.role, isSuperAdmin: args.isSuperAdmin ?? false },
  })
}

async function main() {
  console.log('[seed-demo] Starting')

  // People
  const superAdmin = await upsertUser({ email: 'admin@finskool.com', name: 'Finskool Admin', phone: '+910000000000', password: ADMIN_PASSWORD, role: 'admin', isSuperAdmin: true })
  await prisma.user.update({ where: { id: superAdmin.id }, data: { isSuperAdmin: true } })
  const support = await upsertUser({ email: 'support@finskool.com', name: 'Support Admin', phone: '+910000000001', password: ADMIN_PASSWORD, role: 'admin' })
  const members = [
    await upsertUser({ email: 'priya@example.com', name: 'Priya Sharma', phone: '+919000000101', password: MEMBER_PASSWORD, role: 'member' }),
    await upsertUser({ email: 'rahul@example.com', name: 'Rahul Verma', phone: '+919000000102', password: MEMBER_PASSWORD, role: 'member' }),
    await upsertUser({ email: 'anita@example.com', name: 'Anita Desai', phone: '+919000000103', password: MEMBER_PASSWORD, role: 'member' }),
  ]
  console.log(`[seed-demo] People ready: super admin, support admin, ${members.length} members`)

  // Free community (every member is on it)
  const free = await prisma.community.upsert({
    where: { slug: 'free' },
    update: { isFree: true },
    create: { createdBy: superAdmin.id, name: 'Free', slug: 'free', description: 'Default access granted automatically to every new member.', tags: [], isFree: true },
  })

  // Stocks (only the ones recommendations need)
  const stockIds = new Map<string, string>()
  for (const s of STOCKS) {
    const row = await prisma.stock.upsert({
      where: { symbol: s.symbol },
      update: {},
      create: { name: s.name, symbol: s.symbol, sector: s.sector, token: s.token, exchange: 'nse' },
    })
    stockIds.set(s.symbol, row.id)
  }

  // Communities with everything inside
  const communityIds = new Map<string, string>()
  for (const c of COMMUNITIES) {
    const existing = await prisma.community.findUnique({ where: { slug: c.slug }, select: { id: true, coverImageUrl: true } })
    const content = { name: c.name, type: c.type, subtitle: c.subtitle, description: c.description, tags: c.tags, whatsIncluded: c.whatsIncluded }
    const community = await prisma.community.upsert({
      where: { slug: c.slug },
      // Fill the rich fields; a cover image someone already uploaded is kept.
      update: { ...content, ...(existing?.coverImageUrl ? {} : { coverImageUrl: img(`finskool-${c.slug}`, 1200, 630) }) },
      create: { createdBy: superAdmin.id, slug: c.slug, ...content, coverImageUrl: img(`finskool-${c.slug}`, 1200, 630) },
    })
    communityIds.set(c.slug, community.id)

    // Plans
    for (const p of c.plans) {
      const found = await prisma.plan.findFirst({ where: { communityId: community.id, name: p.name } })
      if (!found) await prisma.plan.create({ data: { communityId: community.id, name: p.name, durationMonths: p.durationMonths, price: p.price, updatedBy: superAdmin.id } })
    }

    // Welcome kit (same shape the admin screen saves)
    const kit = {
      watchBeforeYouStart: { introMarkdown: c.kit.intro, youtubeUrls: c.kit.videos.map(yt) },
      capitalAllocation: { ...c.kit.capital, strategies: priority(c.kit.capital.strategies) },
      strategyNotices: priority(c.kit.notices),
      whatYouGet: priority(c.kit.whatYouGet.map(text => ({ text }))),
    }
    await prisma.communityKit.upsert({
      where: { communityId: community.id },
      update: kit,
      create: { communityId: community.id, ...kit },
    })

    // Posts (published; one pinned)
    let pinOrder = 1
    for (const p of c.posts) {
      const found = await prisma.post.findFirst({ where: { communityId: community.id, title: p.title, deletedAt: null } })
      if (found) continue
      const publishedAt = new Date(Date.now() - p.daysAgo * 24 * 3600e3)
      await prisma.post.create({
        data: {
          communityId: community.id,
          authorId: superAdmin.id,
          title: p.title,
          contentMd: p.content,
          imageUrls: [],
          tags: p.tags,
          status: 'published',
          publishedAt,
          ...(p.pinned ? { pinOrder: pinOrder++, pinnedAt: publishedAt, pinnedBy: superAdmin.id } : {}),
        },
      })
    }

    // Stock recommendations
    for (const r of c.recommendations) {
      const stockId = stockIds.get(r.symbol)
      if (!stockId) continue
      const found = await prisma.stockRecommendation.findFirst({ where: { communityId: community.id, stockId, deletedAt: null } })
      if (found) continue
      await prisma.stockRecommendation.create({
        data: {
          communityId: community.id,
          recommendedBy: superAdmin.id,
          stockId,
          entryPrice: r.entry,
          targetPrice: r.target,
          stopLossPrice: r.stop,
          actionCall: r.action,
          riskLevel: r.risk,
          recommendationNotes: r.notes,
        },
      })
    }

    // The support admin looks after the first two communities
    if (['swing-alpha', 'investor-community'].includes(c.slug)) {
      await prisma.communityAdmin.upsert({
        where: { uq_community_admin: { communityId: community.id, adminId: support.id } },
        update: {},
        create: { communityId: community.id, adminId: support.id },
      })
    }
    console.log(`[seed-demo] Community ready: ${c.name} (${c.plans.length} plans, ${c.posts.length} posts, ${c.recommendations.length} recommendations, welcome kit)`)
  }

  // Subscriptions: who is in what (priya expires soon so reminders can be tried)
  const subs: { user: (typeof members)[number]; slug: string; validDays: number; payment: number }[] = [
    { user: members[0]!, slug: 'swing-alpha', validDays: 60, payment: 3999 },
    { user: members[0]!, slug: 'investor-community', validDays: 5, payment: 8999 },
    { user: members[1]!, slug: 'swing-alpha', validDays: 25, payment: 1499 },
    { user: members[1]!, slug: 'intraday-edge', validDays: 80, payment: 5499 },
    { user: members[2]!, slug: 'investor-community', validDays: 200, payment: 8999 },
    { user: members[2]!, slug: 'dividend-income', validDays: 300, payment: 5999 },
  ]
  for (const m of members) {
    const hasFree = await prisma.subscription.findFirst({ where: { userId: m.id, communityId: free.id } })
    if (!hasFree) await prisma.subscription.create({ data: { userId: m.id, communityId: free.id, payment: 0, validUntil: daysFromNow(36500), source: 'free-signup' } })
  }
  for (const s of subs) {
    const communityId = communityIds.get(s.slug)!
    const found = await prisma.subscription.findFirst({ where: { userId: s.user.id, communityId } })
    if (!found) {
      await prisma.subscription.create({ data: { userId: s.user.id, communityId, payment: s.payment, paidOn: daysFromNow(-10), validUntil: daysFromNow(s.validDays), source: 'admin-added' } })
    }
    await prisma.communityMember.upsert({
      where: { uq_community_member: { communityId, userId: s.user.id } },
      update: {},
      create: { communityId, userId: s.user.id, role: 'member' },
    })
  }
  for (const id of [...communityIds.values(), free.id]) {
    const active = await prisma.subscription.groupBy({ by: ['userId'], where: { communityId: id, isActive: true, validUntil: { gte: daysFromNow(0) } } })
    await prisma.community.update({ where: { id }, data: { activeSubCount: active.length } })
  }
  console.log('[seed-demo] Subscriptions ready')

  // Service catalog
  for (const s of SERVICES) {
    const found = await prisma.service.findFirst({ where: { title: s.title, deletedAt: null } })
    if (found) continue
    await prisma.service.create({
      data: {
        name: s.title,
        title: s.title,
        description: s.description,
        imageUrl: img(s.image),
        iconUrl: img(`${s.image}-icon`, 256, 256),
        serviceType: s.serviceType,
        tags: s.tags,
        highlights: s.highlights,
        whatMembersGet: s.whatMembersGet,
        isActive: true,
        createdBy: superAdmin.id,
      },
    })
  }
  console.log(`[seed-demo] Services ready: ${SERVICES.length}`)

  // Demo billing details so quotes and invoices can be tried. Only when nothing is set yet, and the
  // GSTIN below is a made-up number that passes the checksum: replace it in Billing settings for real use.
  const billing = await prisma.billingSettings.findUnique({ where: { id: 'default' } })
  if (!billing?.gstin) {
    const data = {
      legalName: 'Finskool Demo Services Pvt Ltd',
      addressLine: '5th Floor, Trade Centre, BKC',
      city: 'Mumbai',
      pincode: '400051',
      stateCode: '27',
      gstin: '27AAPFU0939F1ZV',
      sacCode: '998311',
      contactEmail: 'billing@finskool.example',
    }
    await prisma.billingSettings.upsert({ where: { id: 'default' }, update: data, create: { id: 'default', ...data } })
    console.log('[seed-demo] Demo billing settings added (replace the GSTIN before real use)')
  }

  console.log('\n[seed-demo] Done. Logins:')
  console.log(`  Super admin  admin@finskool.com    ${ADMIN_PASSWORD}`)
  console.log(`  Support admin support@finskool.com ${ADMIN_PASSWORD}`)
  console.log(`  Members      priya@example.com, rahul@example.com, anita@example.com    ${MEMBER_PASSWORD}`)
}

main()
  .catch(e => {
    console.error('[seed-demo] Failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
