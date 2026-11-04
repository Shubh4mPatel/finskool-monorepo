"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Inbox, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { notificationRoute } from "@/lib/notificationRoute";
import { notificationSocketStore } from "@/store/notifications/notificationSocketStore";
import {
  NotificationCard,
  type Notification,
  type ListNotificationsResponse,
} from "@/components/NotificationCard";
import { EmptyState, Skeleton, stagger } from "@/components/admin/dashboard/Panel";
import Pagination from "@/components/ui/Pagination";

const PAGE_SIZE = 10;
const listUrl = (page: number) => `/api/v1/notifications?page=${page}&pageSize=${PAGE_SIZE}`;

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
  const [page, setPage] = useState(1);
  // The page the rows on screen belong to: while it differs from `page`, a new page is on its way.
  const [loadedPage, setLoadedPage] = useState(1);
  const [paging, setPaging] = useState({ total: 0, pageSize: PAGE_SIZE });
  // Unread across every page: the header and "Mark all as read" must not depend on which page is showing.
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  // `loading` = nothing to show yet (skeleton). Later refreshes — the button, a page change, or a live socket
  // event — keep the list on screen and only spin the button or dim the rows, so the page never flashes.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  // The one place the list is fetched: the first load, a page change, the Refresh button and live socket events
  // (all of which bump `page` or `reloadTick`). State is only set from the request's callbacks, and not after unmount.
  useEffect(() => {
    let cancelled = false;
    let steppedBack = false;
    Promise.all([
      api.get<ListNotificationsResponse>(listUrl(page)),
      api.get<{ count: number }>("/api/v1/notifications/unread-count").catch(() => null),
    ])
      .then(([data, unread]) => {
        if (cancelled) return;
        // The last notification on the last page was cleared elsewhere: go back a page instead of showing nothing.
        if (data.notifications.length === 0 && data.total > 0 && page > 1) {
          steppedBack = true;
          setPage(Math.max(1, data.totalPages));
          return;
        }
        setNotifications(data.notifications);
        setPaging({ total: data.total, pageSize: data.pageSize });
        setLoadedPage(page);
        if (unread) setUnreadTotal(unread.count);
      })
      .catch(() => !cancelled && setNotifications([]))
      .finally(() => {
        if (cancelled || steppedBack) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, reloadTick]);

  useEffect(() => {
    notificationSocketStore.connect();
    return notificationSocketStore.subscribe(() => setReloadTick(t => t + 1));
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTick(t => t + 1);
  }, []);

  function goToPage(next: number) {
    setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const handleView = useCallback(async (notification: Notification) => {
    if (!notification.isRead) {
      setNotifications(prev => prev.map(n => (n.id === notification.id ? { ...n, isRead: true } : n)));
      setUnreadTotal(n => Math.max(0, n - 1));
      try {
        await api.patch(`/api/v1/notifications/${notification.id}/read`, {});
        window.dispatchEvent(new Event("notifications:updated"));
      } catch {
        // best-effort optimistic update
      }
    }
    // The routing data the server sends decides the page (the old per-type map is only a fallback).
    const link = notificationRoute(notification);
    if (link) {
      router.push(link);
    }
  }, [router]);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    const previous = notifications;
    const previousUnread = unreadTotal;
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadTotal(0);
    try {
      await api.patch("/api/v1/notifications/mark-all-read", {});
      window.dispatchEvent(new Event("notifications:updated"));
    } catch {
      // put the unread ones back if the server refused
      setNotifications(previous);
      setUnreadTotal(previousUnread);
    } finally {
      setMarkingAll(false);
    }
  }, [notifications, unreadTotal]);

  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div ref={topRef} className="flex scroll-mt-4 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Notifications</p>
          <h1 className="font-display text-2xl font-bold text-primary">Notifications</h1>
          <p className="mt-1 text-sm text-muted">
            {loading
              ? "Loading your notifications…"
              : unreadTotal > 0
                ? `You have ${unreadTotal} unread notification${unreadTotal === 1 ? "" : "s"}.`
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
          {unreadTotal > 0 && (
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
        <div aria-busy={loadedPage !== page} className={`flex flex-col gap-6 transition-opacity duration-300 ${loadedPage !== page ? "pointer-events-none opacity-50" : "opacity-100"}`}>
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

          <Pagination
            page={loadedPage}
            pageSize={paging.pageSize}
            total={paging.total}
            noun={paging.total === 1 ? "notification" : "notifications"}
            onPage={goToPage}
          />
        </div>
      )}
    </div>
  );
}
