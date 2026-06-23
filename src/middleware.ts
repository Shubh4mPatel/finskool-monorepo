import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Routes that require authentication
const PROTECTED = ['/feed', '/announcements', '/profile', '/recommendations', '/replies', '/stock-tracker', '/admin']
// Routes only for unauthenticated users (redirect away if already logged in)
const AUTH_ONLY = ['/login', '/signup']

function decodeJwtPayload(token: string): { exp?: number; role?: string } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

function isExpired(payload: { exp?: number }): boolean {
  if (!payload.exp) return true
  // Add 5-second buffer to avoid edge-case expiry during the request
  return Date.now() / 1000 > payload.exp - 5
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED.some(p => pathname.startsWith(p))
  const isAuthOnly = AUTH_ONLY.some(p => pathname.startsWith(p))

  const accessToken = request.cookies.get('access_token')?.value
  const refreshToken = request.cookies.get('refresh_token')?.value

  // Decode without verifying — backend verifies on every real request
  const payload = accessToken ? decodeJwtPayload(accessToken) : null
  const tokenValid = payload && !isExpired(payload)

  // --- Already logged in → redirect away from /login and /signup ---
  if (isAuthOnly && tokenValid) {
    const role = payload?.role
    return NextResponse.redirect(
      new URL(role === 'admin' ? '/admin/dashboard' : '/feed', request.url),
    )
  }

  if (!isProtected) return NextResponse.next()

  // --- Protected route: token is valid, just check role ---
  if (tokenValid) {
    const role = payload?.role
    if (pathname.startsWith('/admin') && role !== 'admin') {  // admin-only check
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  // --- Token missing or expired: try silent refresh ---
  if (refreshToken) {
    try {
      const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'GET',
        headers: { Cookie: `refresh_token=${refreshToken}` },
        credentials: 'include',
      })

      if (refreshRes.ok) {
        // Forward the new access_token cookie the backend set
        const newCookieHeader = refreshRes.headers.get('set-cookie')
        const response = NextResponse.next()
        if (newCookieHeader) {
          response.headers.set('set-cookie', newCookieHeader)
        }

        // Re-check role from new token for admin routes
        const newAccessToken = newCookieHeader?.match(/access_token=([^;]+)/)?.[1]
        if (newAccessToken && pathname.startsWith('/admin')) {
          const newPayload = decodeJwtPayload(newAccessToken)
          if (newPayload?.role !== 'admin') {
            return NextResponse.redirect(new URL('/', request.url))
          }
        }

        return response
      }
    } catch {
      // Refresh failed — fall through to redirect
    }
  }

  // No valid token and refresh failed — redirect to login
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/feed/:path*',
    '/announcements/:path*',
    '/profile/:path*',
    '/recommendations/:path*',
    '/replies/:path*',
    '/stock-tracker/:path*',
    '/admin/:path*',
    '/login',
    '/signup',
  ],
}
