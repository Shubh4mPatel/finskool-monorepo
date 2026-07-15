"use client";

import { useEffect, useState, useCallback } from "react";
import { Calendar, ChevronDown, Search } from "lucide-react";
import CommunityRulesWidget from "@/components/CommunityRulesWidget";
import MarketTodayWidget from "@/components/MarketTodayWidget";
import FeedPostCard from "@/components/feed/FeedPostCard";
import { api } from "@/lib/api";

interface FeedPost {
  id: string;
  communityId: string;
  communityName: string;
  communitySlug: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  imageUrls: string[];
  tags: string[];
  pinOrder: number | null;
  publishedAt: string | null;
  createdAt: string;
  commentCount: number;
}

interface ListPostsResponse {
  posts: FeedPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

export default function FeedPage() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchPosts = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: "20" });
      const data = await api.get<ListPostsResponse>(`/api/v1/posts?${params}`);
      setPosts(data.posts);
      setTotalPages(data.totalPages);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(page);
  }, [fetchPosts, page]);

  const displayed = posts
    .filter(p =>
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
    )
    .slice()
    .sort((a, b) => {
      // Pinned posts always come first, regardless of sort direction
      if (a.pinOrder !== null && b.pinOrder === null) return -1;
      if (a.pinOrder === null && b.pinOrder !== null) return 1;
      if (a.pinOrder !== null && b.pinOrder !== null) return a.pinOrder - b.pinOrder;
      // Non-pinned: sort by date
      const ta = new Date(a.publishedAt ?? a.createdAt).getTime();
      const tb = new Date(b.publishedAt ?? b.createdAt).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex-1 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-xl font-semibold text-primary">Live Feed</h1>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-full border border-accent bg-white px-4 py-2.5 transition-colors sm:flex-none">
              <Search size={16} className="shrink-0 text-accent" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search with Title and hashtags....."
                className="w-full bg-transparent text-sm text-primary placeholder:text-accent/70 focus:outline-none sm:w-56"
              />
            </div>
            <button
              className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
              type="button"
            >
              Date <Calendar size={14} />
            </button>
            <button
              onClick={() => setSortDesc(p => !p)}
              type="button"
              className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95"
            >
              {sortDesc ? "Latest First" : "Oldest First"}
              <ChevronDown size={16} className={sortDesc ? "" : "rotate-180"} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-5">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-white shadow-card" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-2xl bg-white shadow-card">
            <p className="font-display text-base font-semibold text-primary">No posts yet</p>
            <p className="mt-1 text-sm text-muted">Check back later for updates from your community.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {displayed.map((post, i) => (
              <div key={post.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <FeedPostCard
                  postId={post.id}
                  commentCount={post.commentCount}
                  communityName={post.communityName}
                  authorName={post.authorName}
                  authorAvatarUrl={post.authorAvatarUrl}
                  badge={post.pinOrder !== null ? { label: "PINNED", icon: "pin" } : undefined}
                  timestamp={formatTimestamp(post.publishedAt ?? post.createdAt)}
                  title={post.title}
                  body=""
                  bodyHtml={post.content}
                  imageUrls={post.imageUrls}
                  tags={post.tags}
                />
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-muted">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <aside className="flex w-full flex-col gap-5 sm:flex-row lg:w-70 lg:shrink-0 lg:flex-col lg:self-start lg:sticky lg:top-8">
        <MarketTodayWidget />
        <CommunityRulesWidget />
      </aside>
    </div>
  );
}
