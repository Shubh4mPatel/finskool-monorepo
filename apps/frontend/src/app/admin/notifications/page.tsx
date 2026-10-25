"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Inbox, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { notificationSocketStore } from "@/store/notifications/notificationSocketStore";
import {
  NotificationCard,
  type Notification,
  type ListNotificationsResponse,
} from "@/components/NotificationCard";
import { EmptyState, Skeleton, stagger } from "@/components/admin/dashboard/Panel";

// type -> route mapping for the admin side. "thread" lands here (not on the
// member map) because an admin can be the direct target of a reply too, when
// a member replies to the admin's own comment.
const ROUTE_BY_TYPE: Record<string, string> = {
  thread: "/admin/feed",
  "new-member-registered": "/admin/members",
  "import-complete": "/admin/import-csv",
  "new-member-reply": "/admin/feed",
  reaction: "/admin/feed", // fallback when the post is gone
};

const LIST_URL = "/api/v1/notifications?page=1&pageSize=20";

function SectionTitle({ title, count, highlight = false }: { title: string; count: number; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="font-display text-lg font-semibold text-primary">{title}</h2>
      {count > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            highlight ? "bg-lime text-primary" : "bg-divider text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // `loading` = nothing to show yet (skeleton). Later refreshes — the button, or a live socket
  // event — keep the list on screen and only spin the button, so the page never flashes.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  // Reloads for the Refresh button and live socket events; the list stays on screen meanwhile.
  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<ListNotificationsResponse>(LIST_URL);
      setNotifications(data.notifications);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // First load: state is only set from the request's callbacks, and not at all after unmount.
  useEffect(() => {
    let cancelled = false;
    api
      .get<ListNotificationsResponse>(LIST_URL)
      .then(data => !cancelled && setNotifications(data.notifications))
      .catch(() => !cancelled && setNotifications([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    notificationSocketStore.connect();
    return notificationSocketStore.subscribe(() => fetchNotifications());
  }, [fetchNotifications]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
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
    // Reactions and replies name their post: open the feed on just that post.
    const postId = notification.data?.type === "post" ? notification.data.id : null;
    const link = postId ? `/admin/feed?post=${postId}` : ROUTE_BY_TYPE[notification.type];
    if (link) {
      router.push(link);
    }
  }, [router]);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    const previous = notifications;
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await api.patch("/api/v1/notifications/mark-all-read", {});
      window.dispatchEvent(new Event("notifications:updated"));
    } catch {
      setNotifications(previous); // put the unread ones back if the server refused
    } finally {
      setMarkingAll(false);
    }
  }, [notifications]);

  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Notifications</p>
          <h1 className="font-display text-2xl font-bold text-primary">Notifications</h1>
          <p className="mt-1 text-sm text-muted">
            {loading
              ? "Loading your notifications…"
              : unread.length > 0
                ? `You have ${unread.length} unread notification${unread.length === 1 ? "" : "s"}.`
                : "You're all caught up."}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            type="button"
            disabled={refreshing}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-primary shadow-card ring-1 ring-primary/[0.06] transition-all hover:-translate-y-px hover:shadow-card-hover disabled:opacity-70"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          {unread.length > 0 && (
            <button
              onClick={handleMarkAllRead}
              type="button"
              disabled={markingAll}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:opacity-70"
            >
              <CheckCheck size={15} className="text-lime" />
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-card">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex rounded-2xl bg-white shadow-card">
          <EmptyState icon={<BellOff size={20} />}>No notifications yet. New member activity will show up here.</EmptyState>
        </div>
      ) : (
        <>
          {/* New / unread */}
          <section className="flex flex-col gap-3">
            <SectionTitle title="New" count={unread.length} highlight />
            {unread.length === 0 ? (
              <div className="flex rounded-2xl border border-dashed border-divider bg-white/60">
                <EmptyState icon={<Inbox size={20} />}>No new notifications.</EmptyState>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {unread.map((notification, i) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onView={handleView}
                    style={stagger(i)}
                    // Unread: a teal edge so new items stand out from the earlier ones.
                    className="animate-enter border-l-4 border-accent transition-shadow hover:shadow-card-hover"
                  />
                ))}
              </div>
            )}
          </section>

          {/* Earlier / read */}
          {read.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle title="Earlier" count={read.length} />
              <div className="flex flex-col gap-3">
                {read.map((notification, i) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onView={handleView}
                    style={stagger(i, unread.length * 55)}
                    className="animate-enter opacity-90 transition-[opacity,box-shadow] hover:opacity-100 hover:shadow-card-hover"
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
