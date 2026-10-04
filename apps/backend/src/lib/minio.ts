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

export default client
