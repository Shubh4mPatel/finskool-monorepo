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
// browser-reachable hostname (localhost). We pre-seed the region cache so minio-js
// skips the getBucketRegion() network call, which would fail because localhost:9000
// is unreachable from inside the Docker container. MinIO always defaults to us-east-1.
const publicClient = new Minio.Client({
  endPoint: env.minio.publicEndPoint,
  port: env.minio.publicPort,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
});
(publicClient as unknown as { regionMap: Record<string, string> }).regionMap[env.minio.bucket] = 'us-east-1'

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

  const protocol = env.minio.useSSL ? 'https' : 'http'
  return `${protocol}://${env.minio.endPoint}:${env.minio.port}/${env.minio.bucket}/${objectName}`
}

export async function generateUploadUrl(
  originalName: string,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const ext = originalName.split('.').pop() ?? 'bin'
  const objectName = `posts/${randomUUID()}.${ext}`

  // Use publicClient so the HMAC signature is bound to the browser-reachable hostname.
  // Presigning is purely local — no network call is made to MinIO here.
  const uploadUrl = await publicClient.presignedPutObject(env.minio.bucket, objectName, 5 * 60)

  const protocol = env.minio.useSSL ? 'https' : 'http'
  const publicUrl = `${protocol}://${env.minio.publicEndPoint}:${env.minio.publicPort}/${env.minio.bucket}/${objectName}`

  return { uploadUrl, publicUrl }
}

export async function deleteFile(url: string): Promise<void> {
  const objectName = url.split(`/${env.minio.bucket}/`)[1]
  if (!objectName) return
  await client.removeObject(env.minio.bucket, objectName)
}

export default client
