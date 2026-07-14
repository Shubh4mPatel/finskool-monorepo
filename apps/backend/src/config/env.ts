function parseOrigin(raw: string): string | string[] {
  if (raw === '*') return '*'
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length === 1 ? (parts[0] as string) : parts
}

export const env = {
  nodeEnv: (process.env['NODE_ENV'] ?? 'development') as 'development' | 'production' | 'test',
  port: Number(process.env['PORT'] ?? 3000),

  cors: {
    origin: parseOrigin(process.env['CORS_ORIGIN'] ?? 'http://localhost:5173'),
    credentials: process.env['CORS_CREDENTIALS'] !== 'false',
  },

  database: {
    url: process.env['DATABASE_URL'] ?? '',
  },

  redis: {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    password: process.env['REDIS_PASSWORD'] ?? '',
    db: Number(process.env['REDIS_DB'] ?? 0),
  },

  jwt: {
    secret: process.env['JWT_SECRET'] ?? '',
    accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
  },

  cookie: {
    secure: process.env['COOKIE_SECURE'] !== 'false',
  },

  minio: {
    endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
    publicEndPoint: process.env['MINIO_PUBLIC_ENDPOINT'] ?? process.env['MINIO_ENDPOINT'] ?? 'localhost',
    port: Number(process.env['MINIO_PORT'] ?? 9000),
    publicPort: Number(process.env['MINIO_PUBLIC_PORT'] ?? process.env['MINIO_PORT'] ?? 9000),
    useSSL: process.env['MINIO_USE_SSL'] === 'true',
    accessKey: process.env['MINIO_ACCESS_KEY'] ?? '',
    secretKey: process.env['MINIO_SECRET_KEY'] ?? '',
    bucket: process.env['MINIO_BUCKET'] ?? 'finskool',
  },

  smtp: {
    host: process.env['SMTP_HOST'] ?? 'localhost',
    port: Number(process.env['SMTP_PORT'] ?? 1025),
    secure: process.env['SMTP_SECURE'] === 'true',
    user: process.env['SMTP_USER'] ?? '',
    password: process.env['SMTP_PASSWORD'] ?? '',
    from: process.env['SMTP_FROM'] ?? 'Finskool <notifications@finskool.local>',
  },
} as const satisfies {
  nodeEnv: 'development' | 'production' | 'test'
  port: number
  cors: { origin: string | string[]; credentials: boolean }
  database: { url: string }
  redis: { host: string; port: number; password: string; db: number }
  jwt: { secret: string; accessExpiresIn: string }
  cookie: { secure: boolean }
  minio: { endPoint: string; publicEndPoint: string; port: number; publicPort: number; useSSL: boolean; accessKey: string; secretKey: string; bucket: string }
  smtp: { host: string; port: number; secure: boolean; user: string; password: string; from: string }
}
