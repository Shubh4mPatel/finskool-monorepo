import { useSyncExternalStore } from 'react'

export interface SessionInfo {
  userId: string
  userName: string
  userInitials: string
  communityName: string
  communityId: string
  communityBadgeUrl?: string | null
  avatarUrl?: string | null
  role?: string
  isSuperAdmin?: boolean
}

const KEY = 'finskool_session'

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

export function saveSession(info: SessionInfo): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(info))
}

export function updateSessionCommunity(communityId: string, communityName: string, communityBadgeUrl?: string | null): void {
  if (typeof window === 'undefined') return
  const existing = getSession()
  if (!existing) return
  saveSession({ ...existing, communityId, communityName, communityBadgeUrl: communityBadgeUrl ?? null })
}

export function getSession(): SessionInfo | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionInfo) : null
  } catch {
    return null
  }
}

export function updateSessionAvatar(avatarUrl: string | null): void {
  if (typeof window === 'undefined') return
  const existing = getSession()
  if (!existing) return
  saveSession({ ...existing, avatarUrl })
  window.dispatchEvent(new Event('profile:updated'))
}

export function updateSessionName(userName: string): void {
  if (typeof window === 'undefined') return
  const existing = getSession()
  if (!existing) return
  saveSession({ ...existing, userName, userInitials: initials(userName) })
  window.dispatchEvent(new Event('profile:updated'))
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}

export { initials }

function subscribeToSession(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener('profile:updated', onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener('profile:updated', onChange)
  }
}

/**
 * Whether the signed-in user is a super admin — safe to use while rendering. The session lives in
 * localStorage, which the server can't see, so reading it directly in render makes the server HTML
 * differ from the client's first render (a hydration error). This is `null` ("not known yet") on the
 * server and during hydration, then the real value — so a page can show a spinner rather than
 * flashing "not allowed" at a super admin.
 */
export function useIsSuperAdmin(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribeToSession, () => getSession()?.isSuperAdmin === true, () => null)
}

// useSyncExternalStore needs the same object back until the session actually changes, so the parsed
// value is cached against the raw string it came from.
let cachedRaw: string | null = null
let cachedSession: SessionInfo | null = null

function sessionSnapshot(): SessionInfo | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cachedSession = raw ? (JSON.parse(raw) as SessionInfo) : null
    } catch {
      cachedSession = null
    }
  }
  return cachedSession
}

/**
 * The signed-in user's session — safe to use while rendering, and live: it updates on
 * `profile:updated` and on changes from other tabs. `null` on the server and during hydration
 * (see useIsSuperAdmin for why).
 */
export function useSession(): SessionInfo | null {
  return useSyncExternalStore(subscribeToSession, sessionSnapshot, () => null)
}
