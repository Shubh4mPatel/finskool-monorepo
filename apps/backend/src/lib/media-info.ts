import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from 'ffprobe-static'
import sharp from 'sharp'

// ffprobe ships with the ffprobe-static package (x64/ia32 builds only) unless FFPROBE_PATH points at another one,
// as the Docker images do. ffmpeg itself (poster frames) comes from PATH or FFMPEG_PATH, which fluent-ffmpeg reads.
if (!process.env['FFPROBE_PATH']) ffmpeg.setFfprobePath(ffprobeStatic.path)

export type MediaOrientation = 'portrait' | 'landscape'

export interface MediaSize {
  width: number
  height: number
}

// Far beyond any real photo or clip; anything larger is treated as a broken or hostile file.
const MAX_DIMENSION = 20_000

export const IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif'] as const
export const IMAGE_MIME_BY_FORMAT: Record<(typeof IMAGE_FORMATS)[number], string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}
export const IMAGE_EXT_BY_FORMAT: Record<(typeof IMAGE_FORMATS)[number], string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }

function validSize(width: number | undefined, height: number | undefined): MediaSize | null {
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null
  return { width, height }
}

/** A square counts as landscape. */
export function orientationOf({ width, height }: MediaSize): MediaOrientation {
  return height > width ? 'portrait' : 'landscape'
}

/** width / height, to 4 decimals (1.7778 for 16:9, 0.8 for 4:5). */
export function ratioOf({ width, height }: MediaSize): number {
  return Math.round((width / height) * 10_000) / 10_000
}

export interface ImageInfo extends MediaSize {
  format: (typeof IMAGE_FORMATS)[number]
}

/**
 * The size an image is *shown* at: width and height are swapped when the EXIF orientation says the
 * picture is stored sideways (phone photos). The format is what sharp actually decodes, never the file
 * name or the type the client declared; an SVG, or anything that isn't a photo format, returns null.
 */
export async function inspectImage(input: Buffer | string): Promise<ImageInfo | null> {
  try {
    const meta = await sharp(input, { failOn: 'error' }).metadata()
    const format = meta.format as ImageInfo['format'] | undefined
    if (!format || !IMAGE_FORMATS.includes(format)) return null
    const sideways = (meta.orientation ?? 1) >= 5
    const size = validSize(sideways ? meta.height : meta.width, sideways ? meta.width : meta.height)
    return size ? { ...size, format } : null
  } catch {
    return null
  }
}

export interface VideoInfo extends MediaSize {
  durationSec: number | null
}

interface ProbeStream {
  codec_type?: string
  width?: number
  height?: number
  tags?: Record<string, unknown>
  side_data_list?: Array<{ rotation?: number }>
}

/**
 * Size of the first video stream of a file or http(s) URL, as displayed (a phone clip stored 1920x1080 with
 * a 90 degree rotation tag is 1080x1920), plus its length. Null if ffprobe cannot read a video from it.
 */
export function inspectVideo(source: string): Promise<VideoInfo | null> {
  return new Promise(resolve => {
    ffmpeg.ffprobe(source, (err, data) => {
      if (err || !data) return resolve(null)
      const stream = (data.streams as ProbeStream[]).find(s => s.codec_type === 'video')
      if (!stream) return resolve(null)
      const rotation = Math.abs(Number(stream.side_data_list?.find(d => d.rotation !== undefined)?.rotation ?? stream.tags?.['rotate'] ?? 0))
      const sideways = rotation % 180 === 90
      const size = validSize(sideways ? stream.height : stream.width, sideways ? stream.width : stream.height)
      if (!size) return resolve(null)
      const duration = Number(data.format?.duration)
      resolve({ ...size, durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null })
    })
  })
}

/**
 * Writes one frame of a video to `outPath` (a .jpg) as its poster. Best effort: a missing ffmpeg binary or an
 * unreadable clip resolves false, and the post simply has no thumbnail.
 */
export function makeVideoPoster(videoPath: string, outPath: string): Promise<boolean> {
  return new Promise(resolve => {
    ffmpeg(videoPath)
      .inputOptions(['-ss', '0.5'])
      .outputOptions(['-frames:v', '1', '-q:v', '3'])
      .output(outPath)
      .on('end', () => resolve(true))
      .on('error', () => resolve(false))
      .run()
  })
}
