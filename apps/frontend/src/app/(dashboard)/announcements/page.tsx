"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Megaphone, MessagesSquare } from "lucide-react";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";

interface Notification {
  id: string;
  communityId: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListNotificationsResponse {
  notifications: Notification[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NotificationCard({
  notification,
  onView,
}: {
  notification: Notification;
  onView: (id: string, type: string, isRead: boolean) => void;
}) {
  const Icon = notification.type === "thread" ? MessagesSquare : Megaphone;
  const timestamp = formatRelativeTime(notification.createdAt);

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-card">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon size={22} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-base text-black">{notification.message}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-black/60">{timestamp}</span>
          <button
            type="button"
            onClick={() => onView(notification.id, notification.type, notification.isRead)}
            className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold text-white"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const session = getSession();
      const communityId = session?.communityId;
      const url = communityId
        ? `/api/v1/notifications?page=1&pageSize=20&communityId=${communityId}`
        : `/api/v1/notifications?page=1&pageSize=20`;
      const data = await api.get<ListNotificationsResponse>(url);
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

  const handleView = useCallback(async (id: string, type: string, isRead: boolean) => {
    if (!isRead) {
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)));
      try {
        await api.patch(`/api/v1/notifications/${id}/read`, {});
        window.dispatchEvent(new Event("notifications:updated"));
      } catch {
        // best-effort optimistic update
      }
    }
    if (type === "post") {
      router.push("/feed");
    }
  }, [router]);

  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-semibold text-primary">Announcement</h1>
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
          {/* New / unread */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-primary">New</h2>
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

          {/* Earlier / read */}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-primary">Earlier</h2>
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
