"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Search, SearchX, Trash2, Users, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useIsSuperAdmin } from "@/lib/session";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import CommunityFormModal from "@/components/admin/communities/CommunityFormModal";
import type { Community } from "@/components/admin/communities/types";
import { EmptyState, Skeleton, stagger } from "@/components/admin/dashboard/Panel";

/** Search is only worth the space once the grid is more than a screenful. */
const SEARCH_THRESHOLD = 6;

// The brand gradient shown behind a community that has no cover image.
const FALLBACK_COVER = "linear-gradient(120deg, #0a5f57, #108b8b)";

export default function CommunitiesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  // null while the session is being read; treated as "not a super admin" until it says otherwise.
  const isSuperAdmin = useIsSuperAdmin() === true;

  const [communities, setCommunities] = useState<Community[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get<Community[]>("/api/v1/admin/communities")
      .then((list) => {
        if (cancelled) return;
        setCommunities(list);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function handleDelete(c: Community) {
    const ok = await confirm({
      title: "Delete Community?",
      message: `This soft-deletes "${c.name}" and all of its posts. Members will lose access to this community, but their accounts and access to other communities are unaffected. This can't be undone from here.`,
      confirmLabel: "Yes, Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(c.id);
    try {
      await api.delete(`/api/v1/admin/communities/${c.id}`);
      toast.success(`${c.name} deleted.`);
      setCommunities((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete community");
    } finally {
      setDeletingId(null);
    }
  }

  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? communities.filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              c.slug.toLowerCase().includes(needle) ||
              c.tags.some((t) => t.toLowerCase().includes(needle)),
          )
        : communities,
    [communities, needle],
  );
  const totalMembers = communities.reduce((sum, c) => sum + c.memberCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Communities</p>
          <h1 className="font-display text-2xl font-bold text-primary">Communities</h1>
          <p className="mt-1 text-sm text-muted">
            All communities across the platform
            {status === "ready" && communities.length > 0 && (
              <>
                {" · "}
                <span className="font-semibold tabular-nums text-primary">{communities.length}</span> communit{communities.length === 1 ? "y" : "ies"},{" "}
                <span className="font-semibold tabular-nums text-primary">{totalMembers.toLocaleString("en-IN")}</span> member{totalMembers === 1 ? "" : "s"}
              </>
            )}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {communities.length > SEARCH_THRESHOLD && (
            <div className="flex min-w-[220px] items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 transition-all focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
              <Search size={15} className="shrink-0 text-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search communities…"
                aria-label="Search communities"
                className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {isSuperAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
            >
              <Plus size={15} className="text-lime" />
              Create Community
            </button>
          )}
        </div>
      </div>

      {status === "loading" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading communities">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl bg-white shadow-card">
              <Skeleton className="aspect-video rounded-none" />
              <div className="space-y-3 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <div className="flex rounded-2xl bg-white shadow-card">
          <EmptyState icon={<SearchX size={20} />}>
            <span className="flex flex-col items-center gap-3">
              Couldn&apos;t load communities.
              <button
                onClick={() => { setStatus("loading"); setReloadTick((t) => t + 1); }}
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                Retry
              </button>
            </span>
          </EmptyState>
        </div>
      ) : communities.length === 0 ? (
        <div className="flex rounded-2xl bg-white shadow-card">
          <EmptyState icon={<Building2 size={20} />}>
            <span className="flex flex-col items-center gap-3">
              No communities yet.
              {isSuperAdmin && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
                >
                  <Plus size={14} className="text-lime" /> Create the first one
                </button>
              )}
            </span>
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex rounded-2xl bg-white shadow-card">
          <EmptyState icon={<SearchX size={20} />}>
            <span className="flex flex-col items-center gap-3">
              No communities match &ldquo;{search}&rdquo;.
              <button onClick={() => setSearch("")} className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent">
                Clear search
              </button>
            </span>
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c, i) => {
            const deleting = deletingId === c.id;
            return (
              <article
                key={c.id}
                style={stagger(Math.min(i, 8), 60, 55)}
                className={`animate-enter group flex flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${
                  deleting ? "pointer-events-none opacity-50" : ""
                }`}
              >
                {/* Cover — the full 16:9 frame, so the photo isn't cropped or tinted */}
                <div className="relative aspect-video overflow-hidden" style={{ background: FALLBACK_COVER }}>
                  {c.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.coverImageUrl} alt={c.name} className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  {!c.coverImageUrl && <Building2 size={30} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/30" aria-hidden />}
                  {/* A soft shade only behind the top-corner controls, so they stay readable on any photo. */}
                  {(c.isFree || isSuperAdmin) && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/25 to-transparent" />}

                  {c.isFree && (
                    <span className="absolute left-3 top-3 rounded-full bg-lime px-2.5 py-1 text-[11px] font-bold text-primary">Open feed</span>
                  )}

                  {isSuperAdmin && (
                    <div className="absolute right-3 top-3 flex gap-1.5">
                      <button
                        onClick={() => setEditingCommunity(c)}
                        title="Edit community"
                        aria-label={`Edit ${c.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-muted shadow-card backdrop-blur transition-all hover:scale-105 hover:text-accent"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={deleting}
                        title="Delete community"
                        aria-label={`Delete ${c.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-muted shadow-card backdrop-blur transition-all hover:scale-105 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background ring-1 ring-divider">
                      <CommunityBadgeIcon badgeUrl={c.badgeUrl} className="h-6 w-6 object-contain" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-base font-bold leading-tight text-primary">{c.name}</h2>
                      <p className="truncate text-xs text-subtle">/{c.slug}</p>
                    </div>
                  </div>
                  {c.description && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted">{c.description}</p>}
                  {c.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {c.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {tag}
                        </span>
                      ))}
                      {c.tags.length > 4 && (
                        <span className="rounded-full bg-divider px-2 py-0.5 text-[10px] font-bold text-muted" title={c.tags.slice(4).join(", ")}>
                          +{c.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between border-t border-divider pt-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/40 px-2.5 py-1 text-[11px] font-bold text-primary">
                        <Users size={12} aria-hidden />
                        <span className="tabular-nums">{c.memberCount.toLocaleString("en-IN")}</span> member{c.memberCount === 1 ? "" : "s"}
                      </span>
                      {c.paymentLink && (
                        <span className="text-[11px] font-semibold text-muted" title={c.paymentLink}>Payment link set</span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CommunityFormModal
          onClose={() => setShowCreate(false)}
          onSaved={(created) => setCommunities((prev) => [created, ...prev])}
        />
      )}

      {editingCommunity && (
        <CommunityFormModal
          community={editingCommunity}
          onClose={() => setEditingCommunity(null)}
          onSaved={(updated) => setCommunities((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))}
        />
      )}
    </div>
  );
}
