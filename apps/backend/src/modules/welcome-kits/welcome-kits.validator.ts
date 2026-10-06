import { z } from 'zod'

export const MAX_YOUTUBE_URLS = 5
export const MAX_STRATEGIES = 10
export const MAX_NOTICES = 5
export const MAX_WHAT_YOU_GET = 15

const text = (max: number) => z.string().trim().max(max)
const requiredText = (max: number, what: string) => z.string().trim().min(1, `${what} is required`).max(max)

// PUT is a full replace of the kit: every section may be empty, but anything sent is validated.
export const upsertWelcomeKitSchema = z.object({
  watchBeforeYouStart: z
    .object({
      introMarkdown: z.string().max(5000).default(''),
      // Parsed/canonicalised in the service (must be real YouTube links); only length-checked here.
      youtubeUrls: z.array(z.string().trim().min(1).max(1000)).max(MAX_YOUTUBE_URLS).default([]),
    })
    .default({ introMarkdown: '', youtubeUrls: [] }),
  capitalAllocation: z
    .object({
      heroStat: text(50).default(''),
      description: text(1000).default(''),
      strategyTitle: text(100).default(''),
      strategies: z
        .array(z.object({ value: requiredText(20, 'Value'), label: requiredText(100, 'Label') }))
        .max(MAX_STRATEGIES)
        .default([]),
    })
    .default({ heroStat: '', description: '', strategyTitle: '', strategies: [] }),
  strategyNotices: z
    .array(
      z.object({
        type: z.enum(['normal', 'warning']),
        heading: requiredText(100, 'Heading'),
        description: text(500).default(''),
      }),
    )
    .max(MAX_NOTICES)
    .default([]),
  whatYouGet: z
    .array(z.object({ text: requiredText(200, 'Text') }))
    .max(MAX_WHAT_YOU_GET)
    .default([]),
})
