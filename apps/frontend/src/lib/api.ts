const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// 401s on these endpoints mean bad credentials, not an expired session — never worth a refresh retry
const NO_REFRESH_RETRY = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh']

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Single-flight: concurrent 401s share one refresh call instead of firing one each
let refreshPromise: Promise<boolean> | null = null

function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/v1/auth/refresh`, { credentials: 'include' })
      .then(res => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  // Access token expired mid-session: refresh once and retry before giving up
  if (res.status === 401 && !isRetry && !NO_REFRESH_RETRY.includes(path)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return request<T>(path, init, true)
  }

  const json = await res.json().catch(() => ({ success: false, message: 'Unexpected response from server' }))

  if (!res.ok) {
    throw new ApiError(res.status, json.message ?? 'Request failed', json.code)
  }

  return json.data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, {
      method: 'POST',
      body: form,
      headers: {},  // let browser set multipart boundary
    }),
}
