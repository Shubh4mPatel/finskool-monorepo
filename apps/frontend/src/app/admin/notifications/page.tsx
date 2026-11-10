"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Inbox, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { notificationRoute } from "@/lib/notificationRoute";
import { notificationSocketStore } from "@/store/notifications/notificationSocketStore";
import {
  NotificationCard,
  type Notification,
  type ListNotificationsResponse,
} from "@/components/NotificationCard";
import { EmptyState, Skeleton, stagger } from "@/components/admin/dashboard/Panel";

/** Notifications fetched at a time: the first screen, then another batch each time the end of the list nears. */
const BATCH_SIZE = 20;
// unreadFirst: every unread notification before the read ones, each group newest to oldest, so "New" is the whole unread list.
const listUrl = (cursor?: string) => `/api/v1/notifications?pageSize=${BATCH_SIZE}&unreadFirst=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

/** The first `count` batches, newest first. Paging is by cursor, which stays correct while new notifications arrive. */
async function fetchBatches(count: number): Promise<{ items: Notification[]; cursor: string | null }> {
  const first = await api.get<ListNotificationsResponse>(listUrl());
  let items = first.notifications;
  let cursor = first.nextCursor;
  for (let i = 1; i < count && cursor; i++) {
    const next = await api.get<ListNotificationsResponse>(listUrl(cursor));
    const seen = new Set(items.map(n => n.id));
    items = [...items, ...next.notifications.filter(n => !seen.has(n.id))];
    cursor = next.nextCursor;
  }
  return { items, cursor };
}

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
  // Where the next batch starts; null once everything has been loaded.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Unread across everything, not just what has been scrolled in: the header and "Mark all as read" depend on it.
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  // How many batches have been loaded. A reload fetches that many again, so a live update refreshes the rows in
  // place instead of cutting the list back to the first screen.
  const batchesLoaded = useRef(1);
  // Bumped by every reload, so a "load more" that was already on its way cannot append to a list that has been replaced.
  const generation = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // `loading` = nothing to show yet (skeleton). Later refreshes — the button or a live socket event — keep the list
  // on screen and only spin the button, so the page never flashes.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  // The first load, the Refresh button and live socket events (all of which bump `reloadTick`). State is only set
  // from the request's callbacks, and not after unmount. A failed refresh leaves what is on screen alone.
  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    Promise.all([
      fetchBatches(batchesLoaded.current),
      api.get<{ count: number }>("/api/v1/notifications/unread-count").catch(() => null),
    ])
      .then(([result, unread]) => {
        if (cancelled) return;
        setNotifications(result.items);
        setNextCursor(result.cursor);
        setLoadMoreFailed(false);
        if (unread) setUnreadTotal(unread.count);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  useEffect(() => {
    notificationSocketStore.connect();
    return notificationSocketStore.subscribe(() => setReloadTick(t => t + 1));
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTick(t => t + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const started = generation.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await api.get<ListNotificationsResponse>(listUrl(nextCursor));
      if (started !== generation.current) return;
      setNotifications(prev => {
        const seen = new Set(prev.map(n => n.id));
        return [...prev, ...next.notifications.filter(n => !seen.has(n.id))];
      });
      setNextCursor(next.nextCursor);
      batchesLoaded.current += 1;
    } catch {
      if (started === generation.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  // Load the next batch when the end of the list comes within a screen of view. The observer is set up afresh after
  // every batch, so if the new rows still do not fill the screen it fires again. After a failure it waits for Retry.
  useEffect(() => {
    const end = sentinelRef.current;
    if (!end || !nextCursor || loadingMore || loadMoreFailed) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadMoreFailed, loadMore, notifications.length]);

  const handleView = useCallback(async (notification: Notification) => {
    if (!notification.isRead) {
      setNotifications(prev => prev.map(n => (n.id === notification.id ? { ...n, isRead: true } : n)));
      setUnreadTotal(n => Math.max(0, n - 1));
      try {
        await api.patch(`/api/v1/notifications/${notification.id}/read`, {});
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
      <div className="flex flex-wrap items-end justify-between gap-4">
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
        <div className="flex flex-col gap-6">
          {/* New / unread */}
          <section className="flex flex-col gap-3">
            <SectionTitle title="New" count={Math.max(unread.length, unreadTotal)} highlight />
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

          {/* End of the list: the next batch loads when this comes near the screen. */}
          <div ref={sentinelRef} aria-hidden className="h-px" />
          <div className="flex min-h-6 items-center justify-center text-sm text-muted" aria-live="polite">
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Loading more…
              </span>
            ) : loadMoreFailed ? (
              <span className="flex items-center gap-3">
                Couldn&apos;t load more notifications.
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-primary transition-colors hover:border-accent"
                >
                  Retry
                </button>
              </span>
            ) : !nextCursor ? (
              <span>That&apos;s all of your notifications.</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
