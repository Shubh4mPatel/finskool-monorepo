"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { notificationSocketStore } from "@/store/notifications/notificationSocketStore";
import {
  NotificationCard,
  type Notification,
  type ListNotificationsResponse,
} from "@/components/NotificationCard";

// type -> route mapping for the admin side. "thread" lands here (not on the
// member map) because an admin can be the direct target of a reply too, when
// a member replies to the admin's own comment.
const ROUTE_BY_TYPE: Record<string, string> = {
  thread: "/admin/feed",
  "new-member-registered": "/admin/members",
  "import-complete": "/admin/import-csv",
  "new-member-reply": "/admin/unresolved-threads",
};

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ListNotificationsResponse>("/api/v1/notifications?page=1&pageSize=20");
      setNotifications(data.notifications);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    notificationSocketStore.connect();
    return notificationSocketStore.subscribe(() => fetchNotifications());
  }, [fetchNotifications]);

  const handleView = useCallback(async (notification: Notification) => {
    if (!notification.isRead) {
      setNotifications(prev => prev.map(n => (n.id === notification.id ? { ...n, isRead: true } : n)));
      try {
        await api.patch(`/api/v1/notifications/${notification.id}/read`, {});
        window.dispatchEvent(new Event("notifications:updated"));
      } catch {
        // best-effort optimistic update
      }
    }
    const link = ROUTE_BY_TYPE[notification.type];
    if (link) {
      router.push(link);
    }
  }, [router]);

  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Notifications</p>
          <h1 className="font-display text-2xl font-bold text-primary">Notifications</h1>
        </div>
        <button
          onClick={fetchNotifications}
          type="button"
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/20"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-22 animate-pulse rounded-2xl bg-white shadow-card" />
          ))}
        </div>
      ) : (
        <>
          {/* Recent / unread */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-primary">Recent</h2>
              {unread.length > 0 && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
              )}
            </div>
            {unread.length === 0 ? (
              <p className="text-sm text-muted">No new notifications.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {unread.map(notification => (
                  <NotificationCard key={notification.id} notification={notification} onView={handleView} />
                ))}
              </div>
            )}
          </section>

          {/* Divider */}
          <div className="h-0.5 bg-[#d9d9d9]" />

          {/* Previous / read */}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-primary">Previous</h2>
            {read.length === 0 ? (
              <p className="text-sm text-muted">No earlier notifications.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {read.map(notification => (
                  <NotificationCard key={notification.id} notification={notification} onView={handleView} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
