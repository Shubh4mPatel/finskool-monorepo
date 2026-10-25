"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Gift, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import { EmptyState, Skeleton, stagger } from "@/components/admin/dashboard/Panel";
import type { KitListItem, KitListResponse, KitListStatus } from "@/lib/welcome-kit";
import { timeAgo } from "@/lib/tickets";


export default function WelcomeKitListPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<KitListStatus>("all");
  // Captured once so render stays pure; "Updated 2 days ago" doesn't need to tick.
  const [now] = useState(() => Date.now());

  // The server filters by tab and returns totals for every tab. The last response remembers which
  // tab it answered, so switching tabs keeps the current cards up (dimmed) until the new ones land.
  const [result, setResult] = useState<(KitListResponse & { status: KitListStatus }) | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<KitListResponse>(`/api/v1/admin/welcome-kits?status=${filter}`)
      .then((data) => !cancelled && setResult({ ...data, status: filter }))
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof ApiError ? err.message : "Failed to load communities");
        setResult({ items: [], counts: { all: 0, ready: 0, pending: 0 }, status: filter });
      });
    return () => {
      cancelled = true;
    };
  }, [filter, reloadTick, toast]);

  async function handleDelete(c: KitListItem) {
    const ok = await confirm({
      title: "Delete Welcome Kit?",
      message: (
        <>
          Are you sure you want to <strong className="font-bold">delete this Welcome Kit</strong>? This action cannot be undone.
        </>
      ),
      confirmLabel: "Yes, Delete",
      variant: "danger",
      icon: <Trash2 size={22} />,
    });
    if (!ok) return;
    setDeletingId(c.communityId);
    try {
      await api.delete(`/api/v1/admin/communities/${c.communityId}/welcome-kit`);
      toast.success(`Welcome kit for ${c.name} deleted.`);
      // The community moves between tabs and every count changes — ask the server again.
      setReloadTick((t) => t + 1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete the welcome kit");
    } finally {
      setDeletingId(null);
    }
  }

  const loading = result === null;
  const refreshing = result !== null && result.status !== filter;
  const items: KitListItem[] = result?.items ?? [];
  const readyCount = result?.counts.ready ?? 0;
  const total = result?.counts.all ?? 0;
  const percent = total > 0 ? Math.round((readyCount / total) * 100) : 0;

  const tabs: { key: KitListStatus; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "ready", label: "Kit ready", count: readyCount },
    { key: "pending", label: "Not set up", count: result?.counts.pending ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Welcome Kit</p>
          <h1 className="font-display text-2xl font-bold text-primary">Welcome Kit</h1>
          <p className="mt-1 text-sm text-muted">The guide each community&apos;s members receive with their subscription.</p>
        </div>

        {/* At-a-glance coverage across communities */}
        {!loading && total > 0 && (
          <div className="animate-fade flex min-w-[240px] items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-card ring-1 ring-primary/[0.04]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lime to-[#a6dc4c] text-primary">
              <Gift size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-primary">
                {readyCount} of {total} set up
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-divider" aria-hidden>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime to-accent transition-all duration-700 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <section className="animate-enter rounded-2xl bg-white shadow-card" style={{ animationDelay: "80ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[15px] font-bold tracking-tight text-primary">
              <Gift size={16} className="text-accent" />
              Manage Welcome Kits
            </h2>
            <p className="mt-0.5 text-xs text-muted">Open a community to create or edit its kit.</p>
          </div>

          {!loading && total > 0 && (
            <div role="group" aria-label="Filter communities" className="flex rounded-full bg-background p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={filter === t.key}
                  onClick={() => setFilter(t.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ${
                    filter === t.key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                      filter === t.key ? "bg-lime text-primary" : "bg-divider text-muted"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
            </div>
          ) : total === 0 ? (
            <EmptyState icon={<Gift size={20} />}>There are no paid communities you can add a welcome kit to.</EmptyState>
          ) : items.length === 0 && !refreshing ? (
            <EmptyState icon={filter === "ready" ? <Gift size={20} /> : <CheckCircle2 size={20} />}>
              {filter === "ready" ? "No community has a welcome kit yet." : "Every community has a welcome kit. Nice work!"}
            </EmptyState>
          ) : (
            <div
              aria-busy={refreshing}
              className={`grid grid-cols-1 gap-4 transition-opacity duration-300 sm:grid-cols-2 xl:grid-cols-3 ${
                refreshing ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {items.map((c, i) => {
                const deleting = deletingId === c.communityId;
                const editHref = `/admin/welcome-kit/${c.communityId}`;
                return (
                  <div
                    key={c.communityId}
                    style={{ background: "linear-gradient(120deg, #0a5f57, #108b8b)", ...stagger(i, 120) }}
                    className={`animate-enter group relative flex h-44 flex-col justify-between overflow-hidden rounded-2xl text-white shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${
                      deleting ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    {c.coverImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.coverImageUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-[#06433d]/95 via-[#0a5f57]/70 to-[#0a5f57]/25" />

                    {/* The whole card opens the editor; the buttons sit above it. */}
                    <Link
                      href={editHref}
                      aria-label={`${c.hasKit ? "Edit" : "Set up"} welcome kit for ${c.name}`}
                      className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lime/70"
                    />

                    {/* Top: badge + status */}
                    <div className="relative flex items-start justify-between p-4">
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-2 ring-white/40">
                        <CommunityBadgeIcon badgeUrl={c.badgeUrl} className="h-6 w-6 object-contain" />
                      </span>
                      {c.hasKit ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-lime px-2.5 py-1 text-[11px] font-bold text-primary">
                          <CheckCircle2 size={12} aria-hidden />
                          Kit ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                          Not set up
                        </span>
                      )}
                    </div>

                    {/* Bottom: name, last update, actions */}
                    <div className="relative flex items-end justify-between gap-3 p-4">
                      <div className="min-w-0">
                        {c.type && <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-white/70">{c.type}</span>}
                        <span className="block truncate font-display text-base font-bold leading-tight">{c.name}</span>
                        <span className="mt-1 block truncate text-[11px] font-medium text-white/75">
                          {c.hasKit
                            ? c.updatedAt
                              ? `Updated ${timeAgo(c.updatedAt, now).toLowerCase()}`
                              : "Kit added"
                            : "Members get no welcome kit yet"}
                        </span>
                      </div>

                      <div className="relative z-20 flex shrink-0 items-center gap-1.5">
                        {c.hasKit && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(c)}
                            disabled={deleting}
                            title="Delete welcome kit"
                            aria-label={`Delete welcome kit for ${c.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-all hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        <Link
                          href={editHref}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary shadow-sm transition-all hover:bg-lime focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
                        >
                          {c.hasKit ? <Pencil size={12} /> : <Plus size={13} strokeWidth={2.5} />}
                          {c.hasKit ? "Edit kit" : "Set up kit"}
                          <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
