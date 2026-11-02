import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { open, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { BadRequestError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import {
  deleteFile,
  uploadFile,
  uploadVideoFile,
  MAX_POST_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  POST_IMAGE_FOLDER,
  VIDEO_TYPES_BY_EXT,
} from '../../lib/minio.js'
import {
  IMAGE_EXT_BY_FORMAT,
  IMAGE_MIME_BY_FORMAT,
  inspectImage,
  inspectVideo,
  makeVideoPoster,
  orientationOf,
  ratioOf,
} from '../../lib/media-info.js'
import type { MediaOrientation } from './posts.dto.js'

const MAX_FILES_PER_REQUEST = 10
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)

// Files go to disk, not memory: a 50 MB video must not sit in the API's RAM, and ffprobe/ffmpeg read paths.
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_req, _file, cb) => cb(null, `post-media-${randomUUID()}`),
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_FILES_PER_REQUEST },
})

/** multer's own errors (too big, too many) become a plain 400 instead of an opaque 500. */
export function receiveMediaFiles(req: Request, res: Response, next: NextFunction): void {
  upload.array('files', MAX_FILES_PER_REQUEST)(req, res, err => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new BadRequestError(`Files can be at most ${mb(MAX_VIDEO_BYTES)} MB`))
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new BadRequestError(`Send up to ${MAX_FILES_PER_REQUEST} files at a time, in the "files" field`))
      }
      return next(new BadRequestError('Upload failed'))
    }
    next(err)
  })
}

export interface UploadedMediaDTO {
  kind: 'image' | 'video'
  name: string
  url: string
  /** Videos only: a poster frame stored beside the file; null if one could not be made. */
  thumbnailUrl: string | null
  width: number
  height: number
  ratio: number
  orientation: MediaOrientation
  durationSec: number | null
}

const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

// An MP4/MOV file has "ftyp" at bytes 4-8; checked so a renamed file is not accepted on its name alone.
async function looksLikeMp4(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(12)
    await handle.read(head, 0, 12, 0)
    return head.subarray(4, 8).toString('latin1') === 'ftyp'
  } finally {
    await handle.close()
  }
}

async function storeImage(file: Express.Multer.File): Promise<UploadedMediaDTO> {
  if (file.size > MAX_POST_IMAGE_BYTES) throw new BadRequestError(`"${file.originalname}": images can be at most ${mb(MAX_POST_IMAGE_BYTES)} MB`)
  const info = await inspectImage(file.path)
  if (!info) throw new BadRequestError(`"${file.originalname}" is not a valid JPG, PNG, WebP or GIF image`)
  const url = await uploadFile(await readFile(file.path), `image.${IMAGE_EXT_BY_FORMAT[info.format]}`, IMAGE_MIME_BY_FORMAT[info.format], POST_IMAGE_FOLDER)
  return {
    kind: 'image',
    name: file.originalname,
    url,
    thumbnailUrl: null,
    width: info.width,
    height: info.height,
    ratio: ratioOf(info),
    orientation: orientationOf(info),
    durationSec: null,
  }
}

async function storeVideo(file: Express.Multer.File, ext: string): Promise<UploadedMediaDTO> {
  if (!(await looksLikeMp4(file.path))) throw new BadRequestError(`"${file.originalname}" is not a valid MP4 or MOV video`)
  const info = await inspectVideo(file.path)
  if (!info) throw new BadRequestError(`"${file.originalname}" could not be read as a video`)

  const posterPath = `${file.path}.jpg`
  const madePoster = (await makeVideoPoster(file.path, posterPath)) && (await stat(posterPath).then(s => s.size > 0, () => false))
  try {
    const stored = await uploadVideoFile(file.path, ext, VIDEO_TYPES_BY_EXT[ext]!, madePoster ? posterPath : null)
    return {
      kind: 'video',
      name: file.originalname,
      url: stored.url,
      thumbnailUrl: stored.thumbnailUrl,
      width: info.width,
      height: info.height,
      ratio: ratioOf(info),
      orientation: orientationOf(info),
      durationSec: info.durationSec,
    }
  } finally {
    await rm(posterPath, { force: true })
  }
}

/**
 * Checks, measures and stores what POST /posts/media received. Images are decoded by sharp and videos probed by
 * ffprobe, so the stored width/height are the real displayed size and the file's type is decided by its content, not
 * its name. If any file is refused, the ones already stored by this request are removed again.
 */
export async function processUploadedMedia(files: Express.Multer.File[]): Promise<UploadedMediaDTO[]> {
  if (files.length === 0) throw new BadRequestError('Send at least one image or video in the "files" field')
  const done: UploadedMediaDTO[] = []
  try {
    for (const file of files) {
      const ext = extOf(file.originalname)
      if (IMAGE_EXTENSIONS.includes(ext)) done.push(await storeImage(file))
      else if (ext in VIDEO_TYPES_BY_EXT) done.push(await storeVideo(file, ext))
      else throw new BadRequestError(`"${file.originalname}": only JPG, PNG, WebP, GIF images and MP4, MOV videos can be uploaded`)
    }
    return done
  } catch (err) {
    await Promise.all(done.flatMap(m => [m.url, m.thumbnailUrl]).filter((u): u is string => !!u).map(u => deleteFile(u).catch(() => {})))
    throw err
  } finally {
    await Promise.all(files.map(f => rm(f.path, { force: true }).catch(err => logger.warn({ err }, 'posts.media: temp file not removed'))))
  }
}
