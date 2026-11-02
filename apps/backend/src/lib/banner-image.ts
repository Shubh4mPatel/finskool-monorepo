import { BadRequestError } from '../shared/errors/index.js'
import { readOwnObject } from './minio.js'
import { inspectImage } from './media-info.js'

// Community covers and service thumbnails are shown as wide cards, so they must all be 5:2 (2.5 : 1) to look alike.
export const BANNER_RATIO = 5 / 2
// A pixel of rounding (1001 x 400) is fine; anything visibly off is not.
const BANNER_RATIO_TOLERANCE = 0.01
export const MAX_BANNER_BYTES = 5 * 1024 * 1024

/**
 * Checks, from the stored file itself (never from anything the client says), that `url` is one of our uploads under
 * `folder`, is a JPG/PNG/WebP up to 5 MB, and has a 5:2 ratio. `what` names the image in the message the admin sees.
 */
export async function assertBannerImage(url: string, folder: string, what: string): Promise<void> {
  const buffer = await readOwnObject(url, folder, MAX_BANNER_BYTES)
  if (!buffer) {
    throw new BadRequestError(`The ${what} was not found or is over 5 MB. Please upload it again.`, 'BANNER_IMAGE_INVALID')
  }
  const info = await inspectImage(buffer)
  if (!info || info.format === 'gif') {
    throw new BadRequestError(`The ${what} must be a JPG, PNG or WebP image.`, 'BANNER_IMAGE_INVALID')
  }
  const ratio = info.width / info.height
  if (Math.abs(ratio - BANNER_RATIO) / BANNER_RATIO > BANNER_RATIO_TOLERANCE) {
    throw new BadRequestError(
      `The ${what} must have a 5:2 ratio (for example 1500 × 600 px). This image is ${info.width} × ${info.height}.`,
      'BANNER_RATIO_INVALID',
    )
  }
}
