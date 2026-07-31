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

  // Used to build absolute links back to the app (e.g. the CTA button in
  // notification emails) — not the same as CORS_ORIGIN, which can be a list.
  frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',

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

  email: {
    // Every template's header/footer <img> references {logo_url}, injected
    // automatically by renderEmail — change this one var to swap the logo
    // everywhere without touching template files or send-email call sites.
    logoUrl: process.env['EMAIL_LOGO_URL'] ?? 'http://157.173.220.80:8081/logo.svg',
  },

  angelone: {
    apiKey: process.env['ANGELONE_API_KEY'] ?? '',
    clientCode: process.env['ANGELONE_CLIENT_CODE'] ?? '',
    pin: process.env['ANGELONE_PIN'] ?? '',
    totpSecret: process.env['ANGELONE_TOTP_SECRET'] ?? '',
  },

  stockQuoteApi: {
    baseUrl: process.env['STOCK_QUOTE_API_BASE_URL'] ?? '',
    apiKey: process.env['STOCK_QUOTE_API_KEY'] ?? '',
    // Comma-separated list — not tied to any user account, so who gets the
    // daily sweep report can be managed independently of admin roles.
    reportEmails: (process.env['STOCK_REPORT_EMAIL'] ?? '').split(',').map(s => s.trim()).filter(Boolean),
  },
} as const satisfies {
  nodeEnv: 'development' | 'production' | 'test'
  port: number
  cors: { origin: string | string[]; credentials: boolean }
  frontendUrl: string
  database: { url: string }
  redis: { host: string; port: number; password: string; db: number }
  jwt: { secret: string; accessExpiresIn: string }
  cookie: { secure: boolean }
  minio: { endPoint: string; publicEndPoint: string; port: number; publicPort: number; useSSL: boolean; accessKey: string; secretKey: string; bucket: string }
  smtp: { host: string; port: number; secure: boolean; user: string; password: string; from: string }
  email: { logoUrl: string }
  angelone: { apiKey: string; clientCode: string; pin: string; totpSecret: string }
  stockQuoteApi: { baseUrl: string; apiKey: string; reportEmails: string[] }
}
