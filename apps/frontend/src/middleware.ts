import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Routes that require authentication
const PROTECTED = ['/feed', '/announcements', '/profile', '/recommendations', '/replies', '/stock-tracker', '/admin']
// Routes only for unauthenticated users (redirect away if already logged in)
const AUTH_ONLY = ['/login', '/signup']

function decodeJwtPayload(
  token: string,
): { exp?: number; role?: string; accessibleCommunityIds?: string[] | null } | null {
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
  if (!isProtected && !isAuthOnly) return NextResponse.next()

  const accessToken = request.cookies.get('access_token')?.value
  const refreshToken = request.cookies.get('refresh_token')?.value

  // Decode without verifying — backend verifies on every real request
  const payload = accessToken ? decodeJwtPayload(accessToken) : null
  let tokenValid = payload && !isExpired(payload)
  let activePayload = payload
  let refreshedCookies: string[] = []

  // --- Access token missing or expired: try a silent refresh ---
  // Applies to auth-only routes too, so a user with just an expired access
  // token (but a valid refresh token) still counts as logged in.
  if (!tokenValid && refreshToken) {
    try {
      const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'GET',
        headers: { Cookie: `refresh_token=${refreshToken}` },
      })

      if (refreshRes.ok) {
        refreshedCookies = refreshRes.headers.getSetCookie()
        const newAccessToken = refreshedCookies
          .map(c => c.match(/^access_token=([^;]+)/)?.[1])
          .find(Boolean)
        const newPayload = newAccessToken ? decodeJwtPayload(newAccessToken) : null
        if (newPayload && !isExpired(newPayload)) {
          tokenValid = true
          activePayload = newPayload
        }
      }
    } catch {
      // Refresh failed — treat as unauthenticated
    }
  }

  // Forward every cookie the backend set — append each one separately so
  // multiple Set-Cookie headers (e.g. a future rotated refresh_token) don't
  // get comma-joined and corrupted (Expires itself contains a comma)
  function withRefreshedCookies(response: NextResponse): NextResponse {
    for (const cookieStr of refreshedCookies) {
      response.headers.append('set-cookie', cookieStr)
    }
    return response
  }

  // --- Auth-only routes: only unauthenticated users may see /login and /signup ---
  if (isAuthOnly) {
    if (tokenValid) {
      const role = activePayload?.role
      return withRefreshedCookies(
        NextResponse.redirect(new URL(role === 'admin' ? '/admin/dashboard' : '/feed', request.url)),
      )
    }
    return NextResponse.next()
  }

  // --- Protected route ---
  if (tokenValid) {
    const role = activePayload?.role
    if (pathname.startsWith('/admin') && role !== 'admin') {  // admin-only check
      return NextResponse.redirect(new URL('/', request.url))
    }
    // Roles & Admins management is super-admin only — accessibleCommunityIds is
    // null exclusively for super admins (scoped admins get an explicit array).
    if (pathname.startsWith('/admin/roles-admins') && activePayload?.accessibleCommunityIds !== null) {
      return withRefreshedCookies(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
    }
    return withRefreshedCookies(NextResponse.next())
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
