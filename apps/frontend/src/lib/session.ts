export interface SessionInfo {
  userId: string
  userName: string
  userInitials: string
  communityName: string
  communityId: string
  avatarUrl?: string | null
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

export function updateSessionCommunity(communityId: string, communityName: string): void {
  if (typeof window === 'undefined') return
  const existing = getSession()
  if (!existing) return
  saveSession({ ...existing, communityId, communityName })
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

export function clearSession(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}

export { initials }
