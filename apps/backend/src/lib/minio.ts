import * as Minio from 'minio'
import { randomUUID } from 'crypto'
import { env } from '../config/env.js'

// Internal client — connects to MinIO using the internal hostname (e.g. "minio" in Docker)
const client = new Minio.Client({
  endPoint: env.minio.endPoint,
  port: env.minio.port,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
})

// Public client — used only for presigned URLs so the HMAC signature is bound to the
// browser-reachable hostname. We pre-seed the region cache so minio-js skips the
// getBucketRegion() network call, which would fail because the public hostname is
// unreachable from inside the Docker container. MinIO always defaults to us-east-1.
const publicClient = new Minio.Client({
  endPoint: env.minio.publicEndPoint,
  port: env.minio.publicPort,
  useSSL: env.minio.publicUseSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
});
(publicClient as unknown as { regionMap: Record<string, string> }).regionMap[env.minio.bucket] = 'us-east-1'
;(publicClient as unknown as { regionMap: Record<string, string> }).regionMap[env.minio.ticketsBucket] = 'us-east-1'
;(publicClient as unknown as { regionMap: Record<string, string> }).regionMap[env.minio.invoicesBucket] = 'us-east-1'

// Nginx proxies /assets/ to the internal MinIO service, stripping the prefix before
// forwarding — so every browser-facing MinIO URL needs "/assets" inserted after the host
// (env.minio.publicPathPrefix; empty in local dev, where nothing strips it).
// This must happen without touching the signed path/query: MinIO validates a presigned
// request's signature against the path it actually receives (post-strip), which still
// matches what publicClient signed, since the prefix never reaches MinIO itself.
function toPublicUrl(objectName: string): string {
  const protocol = env.minio.publicUseSSL ? 'https' : 'http'
  return `${protocol}://${env.minio.publicEndPoint}:${env.minio.publicPort}${env.minio.publicPathPrefix}/${env.minio.bucket}/${objectName}`
}

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimetype: string,
  folder = 'posts',
): Promise<string> {
  const ext = originalName.split('.').pop() ?? 'bin'
  const objectName = `${folder}/${randomUUID()}.${ext}`

  await client.putObject(env.minio.bucket, objectName, buffer, buffer.length, {
    'Content-Type': mimetype,
  })

  return toPublicUrl(objectName)
}

export async function generateUploadUrl(
  originalName: string,
  folder = 'posts',
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const ext = originalName.split('.').pop() ?? 'bin'
  const objectName = `${folder}/${randomUUID()}.${ext}`

  // Use publicClient so the HMAC signature is bound to the browser-reachable hostname.
  // Presigning is purely local — no network call is made to MinIO here.
  const signedUrl = await publicClient.presignedPutObject(env.minio.bucket, objectName, 5 * 60)
  const uploadUrl = new URL(signedUrl)
  uploadUrl.pathname = `${env.minio.publicPathPrefix}${uploadUrl.pathname}`

  return { uploadUrl: uploadUrl.toString(), publicUrl: toPublicUrl(objectName) }
}

function objectNameFromUrl(url: string): string | undefined {
  return url.split(`/${env.minio.bucket}/`)[1] || undefined
}

export async function deleteFile(url: string): Promise<void> {
  const objectName = objectNameFromUrl(url)
  if (!objectName) return
  await client.removeObject(env.minio.bucket, objectName)
}

// ─── Profile pictures ───────────────────────────────────────────────────────
// Uploaded straight to the public bucket via a presigned PUT, which can't constrain size or type,
// so the limits are enforced when the picture is saved (inspectUploadedAvatar) and a rejected
// upload is deleted.
export const AVATAR_FOLDER = 'avatars'
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function avatarExtension(fileName: string): string | null {
  const ext = fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : ''
  return (AVATAR_EXTENSIONS as readonly string[]).includes(ext) ? ext : null
}

/** The object key if `url` is one of our own avatar uploads (right host, bucket and folder), else null. */
export function avatarObjectName(url: string): string | null {
  const base = toPublicUrl(`${AVATAR_FOLDER}/`)
  if (!url.startsWith(base)) return null
  const name = url.slice(base.length)
  if (!name || name.includes('/') || name.includes('..') || name.includes('?') || name.includes('#')) return null
  return `${AVATAR_FOLDER}/${name}`
}

export type AvatarCheck =
  | { ok: true; size: number; mimeType: string }
  | { ok: false; reason: 'foreign_url' | 'not_uploaded' | 'too_large' | 'bad_type' }

/**
 * Checks an uploaded profile picture before it is saved on an account: it must be one of our own
 * avatar objects, exist, be at most AVATAR_MAX_BYTES, really be a JPG/PNG/WebP (by its first bytes,
 * not the name or the declared type), and not be stored with a type that a browser would run as a page
 * (e.g. text/html or image/svg+xml). A file that fails is deleted.
 */
export async function inspectUploadedAvatar(url: string): Promise<AvatarCheck> {
  const objectName = avatarObjectName(url)
  if (!objectName) return { ok: false, reason: 'foreign_url' }
  const reject = async (reason: 'not_uploaded' | 'too_large' | 'bad_type'): Promise<AvatarCheck> => {
    if (reason !== 'not_uploaded') await client.removeObject(env.minio.bucket, objectName).catch(() => {})
    return { ok: false, reason }
  }
  let stat: Awaited<ReturnType<typeof client.statObject>>
  try {
    stat = await client.statObject(env.minio.bucket, objectName)
  } catch {
    return { ok: false, reason: 'not_uploaded' }
  }
  if (stat.size <= 0) return reject('bad_type')
  if (stat.size > AVATAR_MAX_BYTES) return reject('too_large')
  let head: Buffer
  try {
    const stream = await client.getPartialObject(env.minio.bucket, objectName, 0, 12)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    head = Buffer.concat(chunks)
  } catch {
    return { ok: false, reason: 'not_uploaded' }
  }
  const mimeType = sniffTicketMime(head)
  if (!mimeType || !AVATAR_MIME_TYPES.includes(mimeType)) return reject('bad_type')
  const declared = String(stat.metaData?.['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (declared && declared !== 'application/octet-stream' && declared !== mimeType) return reject('bad_type')
  return { ok: true, size: stat.size, mimeType }
}

/** Removes a previous profile picture. Only ever touches our own avatar objects. */
export async function deleteUploadedAvatar(url: string): Promise<void> {
  const objectName = avatarObjectName(url)
  if (!objectName) return
  await client.removeObject(env.minio.bucket, objectName).catch(() => {})
}

// Post videos are uploaded straight from the browser via a presigned PUT, which can't
// constrain size or type — so these limits are enforced after the fact, when the post
// is saved (see statUploadedVideo).
export const VIDEO_FOLDER = 'post-videos'
// Keep in step with the 50 MB body limits on both nginx hops — EqLion's nginx in front
// (finskool-locations.inc: client_max_body_size 50m) and docker/nginx.conf. Anything
// larger is rejected there with a 413 before it ever reaches MinIO.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const VIDEO_TYPES_BY_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime' }

/** Size/type of an uploaded post video, or null if `url` isn't an existing object under post-videos/. */
export async function statUploadedVideo(url: string): Promise<{ size: number; contentType: string } | null> {
  const objectName = objectNameFromUrl(url)
  if (!objectName?.startsWith(`${VIDEO_FOLDER}/`)) return null
  try {
    const stat = await client.statObject(env.minio.bucket, objectName)
    return { size: stat.size, contentType: String(stat.metaData?.['content-type'] ?? '') }
  } catch {
    return null
  }
}

// ─── Support-ticket attachments ─────────────────────────────────────────────
// Private bucket, presigned PUT in / presigned GET out. Like post videos, the PUT
// can't constrain size or type, so every key is inspected (size + magic bytes)
// before a ticket/message is allowed to reference it.
export const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const TICKET_ATTACHMENT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const
const TICKET_DOWNLOAD_EXPIRY_SECONDS = 5 * 60

let ticketsBucketReady: Promise<void> | null = null
/** Creates the private bucket on first use if the minio-init job hasn't (idempotent). */
function ensureTicketsBucket(): Promise<void> {
  ticketsBucketReady ??= (async () => {
    if (!(await client.bucketExists(env.minio.ticketsBucket))) {
      await client.makeBucket(env.minio.ticketsBucket)
    }
  })().catch(err => {
    ticketsBucketReady = null
    throw err
  })
  return ticketsBucketReady
}

function toBrowserUrl(signedUrl: string): string {
  const url = new URL(signedUrl)
  url.pathname = `${env.minio.publicPathPrefix}${url.pathname}`
  return url.toString()
}

export function ticketAttachmentExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return (TICKET_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext) ? ext : null
}

/** Folder inside the private bucket: support tickets and service requests keep their uploads apart. */
export type AttachmentPrefix = 'tickets' | 'services'

export async function generateTicketUploadUrl(
  userId: string,
  ext: string,
  prefix: AttachmentPrefix = 'tickets',
): Promise<{ uploadUrl: string; objectKey: string }> {
  await ensureTicketsBucket()
  const objectKey = `${prefix}/${userId}/${randomUUID()}.${ext}`
  const signedUrl = await publicClient.presignedPutObject(env.minio.ticketsBucket, objectKey, 5 * 60)
  return { uploadUrl: toBrowserUrl(signedUrl), objectKey }
}

function sniffTicketMime(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  return null
}

/**
 * Verifies an uploaded ticket attachment: key must sit under the uploader's own
 * prefix, exist, be within the size limit and actually be an image/PDF (by magic
 * bytes, not the client-declared type). Returns the server-detected type, or null.
 */
export async function inspectTicketAttachment(
  objectKey: string,
  uploaderId: string,
  prefix: AttachmentPrefix = 'tickets',
): Promise<{ size: number; mimeType: string } | null> {
  if (!objectKey.startsWith(`${prefix}/${uploaderId}/`) || objectKey.includes('..')) return null
  try {
    const stat = await client.statObject(env.minio.ticketsBucket, objectKey)
    if (stat.size <= 0 || stat.size > TICKET_ATTACHMENT_MAX_BYTES) return null
    const stream = await client.getPartialObject(env.minio.ticketsBucket, objectKey, 0, 12)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const mimeType = sniffTicketMime(Buffer.concat(chunks))
    return mimeType ? { size: stat.size, mimeType } : null
  } catch {
    return null
  }
}

export async function deleteTicketObject(objectKey: string): Promise<void> {
  try {
    await client.removeObject(env.minio.ticketsBucket, objectKey)
  } catch {
    // best-effort cleanup of a rejected / orphaned upload
  }
}

// ─── GST invoices (PDF) ─────────────────────────────────────────────────────
// Private bucket, generated by the server (never uploaded by users), so the stored Content-Type
// is trustworthy; the download link still pins it.
let invoicesBucketReady: Promise<void> | null = null
function ensureInvoicesBucket(): Promise<void> {
  invoicesBucketReady ??= (async () => {
    if (!(await client.bucketExists(env.minio.invoicesBucket))) {
      await client.makeBucket(env.minio.invoicesBucket)
    }
  })().catch(err => {
    invoicesBucketReady = null
    throw err
  })
  return invoicesBucketReady
}

export async function uploadInvoicePdf(objectKey: string, pdf: Buffer): Promise<void> {
  await ensureInvoicesBucket()
  await client.putObject(env.minio.invoicesBucket, objectKey, pdf, pdf.length, { 'Content-Type': 'application/pdf' })
}

/** Short-lived download link for an invoice PDF. */
export async function generateInvoiceDownloadUrl(objectKey: string, fileName: string): Promise<string> {
  const signedUrl = await publicClient.presignedGetObject(env.minio.invoicesBucket, objectKey, TICKET_DOWNLOAD_EXPIRY_SECONDS, {
    'response-content-type': 'application/pdf',
    'response-content-disposition': contentDisposition(fileName),
  })
  return toBrowserUrl(signedUrl)
}

/** Every upload in the private bucket (tickets and services) with its upload time — input for the orphan sweep. */
export async function* listTicketObjects(): AsyncGenerator<{ name: string; lastModified: Date }> {
  await ensureTicketsBucket()
  const stream = client.listObjectsV2(env.minio.ticketsBucket, '', true)
  for await (const item of stream as AsyncIterable<{ name?: string; lastModified?: Date }>) {
    if (item.name && item.lastModified) yield { name: item.name, lastModified: item.lastModified }
  }
}

// RFC 6266: a quoted ASCII fallback plus the real name percent-encoded in filename*.
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * Short-lived download link for a private ticket attachment.
 *
 * `mimeType` must be the type the server detected from the file's magic bytes. The object's own
 * stored Content-Type is whatever the uploader sent with the presigned PUT (it can't be pinned
 * there), so without overriding it here a member could store HTML under a `.pdf` key and have it
 * render on our origin when an admin opens the link.
 */
export async function generateTicketDownloadUrl(objectKey: string, fileName: string, mimeType: string): Promise<string> {
  const signedUrl = await publicClient.presignedGetObject(
    env.minio.ticketsBucket,
    objectKey,
    TICKET_DOWNLOAD_EXPIRY_SECONDS,
    {
      'response-content-type': mimeType,
      'response-content-disposition': contentDisposition(fileName),
    },
  )
  return toBrowserUrl(signedUrl)
}

export default client
