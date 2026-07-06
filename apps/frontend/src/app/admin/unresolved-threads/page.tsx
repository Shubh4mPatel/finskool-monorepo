"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCheck, ChevronDown, Loader2, Search } from "lucide-react";
import FeedPostCard from "@/components/feed/FeedPostCard";
import { api } from "@/lib/api";

interface PendingPostThread {
  id: string;
  title: string;
  contentMd: string;
  imageUrls: string[];
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  communityId: string;
  communityName: string;
  totalComments: number;
  pendingThreads: number;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

export default function UnresolvedThreadsPage() {
  const [posts, setPosts] = useState<PendingPostThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<PendingPostThread[]>("/api/v1/admin/pending-post-threads")
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const communityMap = new Map<string, string>();
  posts.forEach((p) => communityMap.set(p.communityName, p.communityId));
  const tabs = ["All", ...Array.from(communityMap.keys())];

  const filtered = posts
    .filter((p) => activeTab === "All" || p.communityName === activeTab)
    .filter(
      (p) =>
        !search ||
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
    )
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.publishedAt ?? a.createdAt).getTime();
      const tb = new Date(b.publishedAt ?? b.createdAt).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });

  const pending = filtered.reduce((sum, p) => sum + p.pendingThreads, 0);

  async function handleMarkAllReplied() {
    setMarkingAll(true);
    try {
      const communityId = activeTab === "All" ? undefined : communityMap.get(activeTab);
      await api.patch("/api/v1/admin/comment-notifications/mark-all-replied", { communityId });
      load();
    } catch {
      // ignore — list stays as-is so the admin can retry
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Unresolved Threads</p>
          <h1 className="font-display text-2xl font-bold text-primary">Unresolved Threads</h1>
          <p className="mt-1 text-sm text-muted">Member comments waiting for your response.</p>
        </div>
        {pending > 0 && (
          <span className="mt-1 rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-500">
            {pending} pending
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab ? "bg-primary text-white" : "bg-white text-muted shadow-card hover:bg-divider/60 hover:text-primary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 transition-colors focus-within:border-accent">
            <Search size={16} className="shrink-0 text-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search with Title and hashtags..."
              className="w-40 bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-52"
            />
          </div>
          <button
            onClick={() => setSortDesc((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-muted shadow-card transition-colors hover:bg-divider/60 hover:text-primary"
          >
            {sortDesc ? "Latest First" : "Oldest First"}
            <ChevronDown size={14} className={sortDesc ? "" : "rotate-180"} />
          </button>
          <button
            onClick={handleMarkAllReplied}
            disabled={markingAll || pending === 0}
            className="flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {markingAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
            Mark All Replied
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-5">
          {[0, 1].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-white shadow-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="animate-rise flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-divider bg-white p-16 text-center shadow-card">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/50 to-accent/10 text-primary shadow-glow">
            <Check size={26} />
          </div>
          <p className="font-display text-lg font-bold text-primary">All caught up!</p>
          <p className="max-w-sm text-sm text-muted">Every member comment has received a reply. Great work keeping the community engaged.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {filtered.map((post) => (
            <FeedPostCard
              key={post.id}
              postId={post.id}
              commentCount={post.totalComments}
              communityName={post.communityName}
              badge={{ label: `${post.pendingThreads} pending` }}
              timestamp={formatTimestamp(post.publishedAt ?? post.createdAt)}
              title={post.title}
              body=""
              bodyHtml={post.contentMd}
              imageUrls={post.imageUrls}
              tags={post.tags}
              isAdmin
              defaultThreadsOpen
              onThreadsChange={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
