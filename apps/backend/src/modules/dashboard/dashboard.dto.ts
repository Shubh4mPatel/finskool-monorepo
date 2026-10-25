export interface DashboardKpisDTO {
  totalMembers: { value: number; newThisMonth: number }
  activeSubscriptions: { value: number; pendingRegistration: number }
  revenue: {
    // Month-to-date vs the same elapsed days of last month, e.g. 1–25 Oct vs 1–25 Sep.
    amount: number
    previousAmount: number
    // null when last month's window had no revenue — a percentage of zero is meaningless.
    deltaPercent: number | null
    from: string
    through: string
  }
  tickets: {
    openTickets: number
    openEnquiries: number
    // Support tickets + service enquiries that no admin has replied to yet.
    awaitingFirstReply: number
  }
}

export interface RevenuePointDTO {
  day: number
  date: string
  amount: number
}

export interface DashboardRevenueDTO {
  month: string // YYYY-MM
  previousMonth: string
  // The last day compared. Today for the running month, the month's last day otherwise.
  throughDay: number
  current: RevenuePointDTO[]
  previous: RevenuePointDTO[]
  totalCurrent: number
  totalPrevious: number
  deltaPercent: number | null
}

export interface ExpiringSubscriptionDTO {
  subscriptionId: string
  userId: string
  name: string
  initials: string
  communityId: string
  communityName: string
  validUntil: string
  daysLeft: number
}

export interface DashboardExpiringDTO {
  items: ExpiringSubscriptionDTO[]
  // Everything expiring in the window, not just the items returned.
  total: number
  windowDays: number
}

export interface RegistrationItemDTO {
  userId: string
  name: string
  initials: string
  phone: string
  email: string | null
  // Admin-added members get their account when the admin adds them, so for them this is
  // the "added" date, not when they finished signing up in the app.
  registeredAt: string
  source: 'self' | 'admin'
  communityName: string | null
  accountStatus: 'active' | 'suspended'
  registrationStatus: 'registered' | 'pending'
}

export interface DashboardRegistrationsDTO {
  items: RegistrationItemDTO[]
  last7DaysCount: number
}

export type TicketStatusTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral'

export interface DashboardTicketItemDTO {
  id: string
  kind: 'support' | 'service'
  label: string
  member: { id: string; name: string; initials: string }
  typeLabel: string
  subject: string
  status: { key: string; label: string; tone: TicketStatusTone }
  lastUpdateAt: string
}

export interface DashboardTicketsDTO {
  items: DashboardTicketItemDTO[]
}
