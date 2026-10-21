import type { PrismaClient } from '../../generated/prisma/client.js'
import { NotFoundError } from '../../shared/errors/index.js'

export class PushService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Saves the device token on the caller's mobile session. A phone can only belong to one logged-in member,
   * so the same token is first cleared from any other session (for example the previous owner who logged out
   * of that phone without the app reporting it). Idempotent.
   */
  async registerToken(userId: string, token: string, appVersion: string | undefined): Promise<void> {
    const saved = await this.db.$transaction(async tx => {
      await tx.mobileSession.updateMany({ where: { fcmToken: token, NOT: { userId } }, data: { fcmToken: null, fcmTokenUpdatedAt: null } })
      return tx.mobileSession.updateMany({
        where: { userId },
        data: { fcmToken: token, fcmTokenUpdatedAt: new Date(), ...(appVersion ? { appVersion } : {}) },
      })
    })
    if (saved.count === 0) throw new NotFoundError('No active mobile session')
  }

  async removeToken(userId: string): Promise<void> {
    await this.db.mobileSession.updateMany({ where: { userId }, data: { fcmToken: null, fcmTokenUpdatedAt: null } })
  }

  async getSettings(userId: string): Promise<{ pushEnabled: boolean }> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { pushEnabled: true } })
    if (!user) throw new NotFoundError('User not found')
    return { pushEnabled: user.pushEnabled }
  }

  async updateSettings(userId: string, pushEnabled: boolean): Promise<{ pushEnabled: boolean }> {
    await this.db.user.update({ where: { id: userId }, data: { pushEnabled } })
    return { pushEnabled }
  }
}

/** Clears tokens the app has not refreshed in a long time (the app re-registers on every launch). */
export async function cleanupStalePushTokens(db: PrismaClient, now: Date = new Date()): Promise<{ cleared: number }> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 3600e3)
  const res = await db.mobileSession.updateMany({
    where: { fcmToken: { not: null }, fcmTokenUpdatedAt: { lt: cutoff } },
    data: { fcmToken: null, fcmTokenUpdatedAt: null },
  })
  return { cleared: res.count }
}
