"use client";

import { useEffect, useState } from "react";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { api, ApiError } from "@/lib/api";

interface ReactionType {
  id: number;
  name: string;
  emoji: string;
  sortOrder: number;
}

interface ReactionItem {
  postId: string;
  communityName: string;
  communityIsFree: boolean;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** One filter tab's worth of reactors. Remounted (via `key`) whenever the filter changes. */
function ReactionList({ postId, reactionType, showCommunity }: { postId: string; reactionType: string | null; showCommunity: boolean }) {
  const [items, setItems] = useState<ReactionItem[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(nextPage: number) {
    // scope=group also returns the reactions on this post's copies in other communities.
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE), scope: "group" });
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

  if (loading && items.length === 0) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-divider/60" />)}
      </div>
    );
  }
  if (error && items.length === 0) return <p className="text-sm text-red-600">{error}</p>;
  if (items.length === 0) return <p className="text-sm text-subtle">No reactions yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      {items.map((r) => (
        <div key={`${r.postId}-${r.userId}`} className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-white">
            {r.userAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.userAvatarUrl} alt={r.userName} className="h-full w-full object-cover" />
            ) : (
              initialsOf(r.userName)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-primary">{r.userName}</span>
              {showCommunity && (
                <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {r.communityIsFree ? "Feed" : r.communityName}
                </span>
              )}
            </div>
            <p className="text-[11px] text-subtle">{timeAgo(r.reactedAt)}</p>
          </div>
          <span className="text-xl" title={r.reactionType}>{r.emoji}</span>
        </div>
      ))}
      {page < totalPages && (
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load(page + 1);
          }}
          disabled={loading}
          className="self-start text-sm font-semibold text-accent hover:underline disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Admin view of a post's reactions, laid out like the comment threads under it: a toggle that
 * expands an inline panel listing who reacted. `reactionCounts` already sums the copies one
 * publish made in other communities (`groupSize` of them), and the list matches.
 */
export default function PostReactions({
  postId,
  reactionCounts,
  groupSize = 1,
}: {
  postId: string;
  reactionCounts: Record<string, number>;
  groupSize?: number;
}) {
  const [types, setTypes] = useState<ReactionType[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

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

  const tab = (active: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
      active ? "bg-primary text-white" : "bg-divider/60 text-muted hover:text-primary"
    }`;

  return (
    <div className="mt-4 border-t border-divider pt-4">
      {total === 0 ? (
        <p className="text-sm text-subtle">No reactions yet</p>
      ) : (
        <>
          {/* Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
            >
              {open ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
              {open ? "Hide Reactions" : `View Reactions (${total})`}
            </button>
            {!open && (
              <span className="flex items-center gap-2 text-xs font-semibold text-primary">
                {ordered.map(({ type, count }) => (
                  <span key={type.id} className="flex items-center gap-1">
                    <span className="text-sm">{type.emoji}</span>
                    {count}
                  </span>
                ))}
              </span>
            )}
          </div>

          {open && (
            <div className="mt-5 flex flex-col gap-5 rounded-xl bg-[#fafbfe] p-4">
              <p className="text-sm">
                <span className="font-bold text-primary">Reactions</span>{" "}
                <span className="font-semibold text-accent">({total})</span>
                {groupSize > 1 && (
                  <span className="ml-2 text-xs text-subtle">across {groupSize} communities this was posted to</span>
                )}
              </p>

              <div className="flex gap-2 overflow-x-auto pb-1">
                <button type="button" onClick={() => setFilter(null)} className={tab(filter === null)}>All {total}</button>
                {ordered.map(({ type, count }) => (
                  <button key={type.id} type="button" onClick={() => setFilter(type.name)} className={tab(filter === type.name)}>
                    {type.emoji} {count}
                  </button>
                ))}
              </div>

              <ReactionList key={filter ?? "all"} postId={postId} reactionType={filter} showCommunity={groupSize > 1} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
