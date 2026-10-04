"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface ReactionType {
  id: number;
  name: string;
  emoji: string;
  sortOrder: number;
}

interface ReactionItem {
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  reactionType: string;
  emoji: string;
  reactedAt: string;
}

interface ReactionsResponse {
  reactions: ReactionItem[];
  total: number;
  page: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

// The reaction types are a tiny fixed list, shared by every card on the page — fetch once.
let typesPromise: Promise<ReactionType[]> | null = null;
function loadReactionTypes(): Promise<ReactionType[]> {
  typesPromise ??= api.get<ReactionType[]>("/api/v1/reaction-types").catch((err) => {
    typesPromise = null;
    throw err;
  });
  return typesPromise;
}

function initialsOf(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** One filter tab's worth of reactors. Remounted (via `key`) whenever the filter changes. */
function ReactionList({ postId, reactionType }: { postId: string; reactionType: string | null }) {
  const [items, setItems] = useState<ReactionItem[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
    if (reactionType) params.set("reactionType", reactionType);
    api
      .get<ReactionsResponse>(`/api/v1/posts/${postId}/reactions?${params}`)
      .then((res) => {
        setItems((prev) => (nextPage === 1 ? res.reactions : [...prev, ...res.reactions]));
        setPage(res.page);
        setTotalPages(res.totalPages);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load reactions"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && items.length === 0) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  if (error && items.length === 0) return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted">No reactions yet.</p>;

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-divider">
        {items.map((r) => (
          <li key={`${r.userId}-${r.reactionType}`} className="flex items-center gap-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-white">
              {r.userAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.userAvatarUrl} alt={r.userName} className="h-full w-full object-cover" />
              ) : (
                initialsOf(r.userName)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-primary">{r.userName}</p>
              <p className="text-[11px] text-muted">{formatWhen(r.reactedAt)}</p>
            </div>
            <span className="text-xl" title={r.reactionType}>{r.emoji}</span>
          </li>
        ))}
      </ul>
      {page < totalPages && (
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load(page + 1);
          }}
          disabled={loading}
          className="mt-3 self-center rounded-full border border-divider px-5 py-2 text-xs font-semibold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
      {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReactionsModal({
  postId,
  ordered,
  total,
  initialType,
  onClose,
}: {
  postId: string;
  ordered: { type: ReactionType; count: number }[];
  total: number;
  initialType: string | null;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<string | null>(initialType);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tab = (active: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
      active ? "bg-primary text-white" : "bg-divider/60 text-muted hover:text-primary"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Reactions" className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-primary">Reactions</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-divider/60">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setFilter(null)} className={tab(filter === null)}>All {total}</button>
          {ordered.map(({ type, count }) => (
            <button key={type.id} type="button" onClick={() => setFilter(type.name)} className={tab(filter === type.name)}>
              {type.emoji} {count}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto">
          <ReactionList key={filter ?? "all"} postId={postId} reactionType={filter} />
        </div>
      </div>
    </div>
  );
}

/** Admin view of a post's reactions: counts per type, and a dialog listing who reacted. */
export default function PostReactions({ postId, reactionCounts }: { postId: string; reactionCounts: Record<string, number> }) {
  const [types, setTypes] = useState<ReactionType[]>([]);
  const [open, setOpen] = useState<{ type: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    loadReactionTypes().then((t) => alive && setTypes(t)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const ordered = [...types]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((type) => ({ type, count: reactionCounts[type.name] ?? 0 }))
    .filter((r) => r.count > 0);
  const total = Object.values(reactionCounts).reduce((sum, n) => sum + n, 0);

  if (total === 0) return <p className="text-xs text-subtle">No reactions yet</p>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {ordered.map(({ type, count }) => (
          <button
            key={type.id}
            type="button"
            onClick={() => setOpen({ type: type.name })}
            title={`See who reacted ${type.name}`}
            className="flex items-center gap-1.5 rounded-full border border-divider bg-background px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:border-accent"
          >
            <span className="text-sm">{type.emoji}</span>
            {count}
          </button>
        ))}
        <button type="button" onClick={() => setOpen({ type: null })} className="text-xs font-semibold text-accent hover:underline">
          {total} reaction{total === 1 ? "" : "s"} · View all
        </button>
      </div>
      {open && <ReactionsModal postId={postId} ordered={ordered} total={total} initialType={open.type} onClose={() => setOpen(null)} />}
    </>
  );
}
