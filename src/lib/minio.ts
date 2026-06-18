import * as Minio from 'minio'
import { randomUUID } from 'crypto'
import { env } from '../config/env.js'

const client = new Minio.Client({
  endPoint: env.minio.endPoint,
  port: env.minio.port,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
})

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimetype: string,
): Promise<string> {
  const ext = originalName.split('.').pop() ?? 'bin'
  const objectName = `posts/${randomUUID()}.${ext}`

  await client.putObject(env.minio.bucket, objectName, buffer, buffer.length, {
    'Content-Type': mimetype,
  })

  const protocol = env.minio.useSSL ? 'https' : 'http'
  return `${protocol}://${env.minio.endPoint}:${env.minio.port}/${env.minio.bucket}/${objectName}`
}

export async function deleteFile(url: string): Promise<void> {
  const objectName = url.split(`/${env.minio.bucket}/`)[1]
  if (!objectName) return
  await client.removeObject(env.minio.bucket, objectName)
}

export default client
