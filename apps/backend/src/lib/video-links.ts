import { BadRequestError } from '../shared/errors/index.js'

export type VideoLinkKind = 'youtube' | 'instagram'

export interface ParsedVideoLink {
  kind: VideoLinkKind
  /** YouTube video ID / Instagram shortcode. */
  externalId: string
  /** One stable URL per video, whatever form the admin pasted. */
  canonicalUrl: string
  /** Built from the ID here — never taken from the client — so only these two hosts can ever be framed. */
  embedUrl: string
  /** YouTube only; Instagram's thumbnail is not available without a Meta app token. */
  thumbnailUrl: string | null
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com'])

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,40}$/

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)
  let id: string | undefined
  if (host === 'youtu.be') {
    id = parts[0]
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1]
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

// Accepts /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, each optionally
// prefixed with a username (/<user>/reel/<code>) — the form share sheets produce.
function instagramPost(url: URL): { type: 'p' | 'reel' | 'tv'; code: string } | null {
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const at = parts.findIndex(p => ['p', 'reel', 'reels', 'tv'].includes(p))
  const code = at === -1 ? undefined : parts[at + 1]
  if (at === -1 || at > 1 || !code || !INSTAGRAM_CODE.test(code)) return null
  const raw = parts[at]
  return { type: raw === 'reels' ? 'reel' : (raw as 'p' | 'reel' | 'tv'), code }
}

export function parseVideoLink(raw: string): ParsedVideoLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const yt = youtubeId(url)
  if (yt) {
    return {
      kind: 'youtube',
      externalId: yt,
      canonicalUrl: `https://www.youtube.com/watch?v=${yt}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    }
  }

  const ig = instagramPost(url)
  if (ig) {
    const canonicalUrl = `https://www.instagram.com/${ig.type}/${ig.code}/`
    return { kind: 'instagram', externalId: ig.code, canonicalUrl, embedUrl: `${canonicalUrl}embed`, thumbnailUrl: null }
  }
  return null
}

/**
 * Title via YouTube's public oEmbed endpoint (the only host this ever calls).
 * Private / removed / embedding-disabled videos answer 401/403/404 and are rejected;
 * any other failure (timeout, 5xx) just means "no title" — the link itself is still valid.
 */
export async function fetchYoutubeTitle(canonicalUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if ([401, 403, 404].includes(res.status)) {
      throw new BadRequestError('This YouTube video is private, removed, or does not allow embedding')
    }
    if (!res.ok) return null
    const body = (await res.json()) as { title?: unknown }
    return typeof body.title === 'string' ? body.title.slice(0, 300) : null
  } catch (err) {
    if (err instanceof BadRequestError) throw err
    return null
  }
}
