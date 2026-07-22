"use client";

import { useEffect, useState, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Calendar, ChevronDown, Search, X } from "lucide-react";
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

// Formats using the date's own calendar fields (not toISOString, which shifts
// to UTC and can land on the wrong day depending on the browser's timezone).
function toDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function FeedPage() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchPosts = useCallback(async (pg: number, ord: "asc" | "desc", date: Date | undefined) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: "20", order: ord });
      if (date) params.set("date", toDateParam(date));
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
    fetchPosts(page, order, selectedDate);
  }, [fetchPosts, page, order, selectedDate]);

  function handleSelectDate(date: Date | undefined) {
    setSelectedDate(date);
    setShowDatePicker(false);
    setPage(1);
  }

  function clearDate(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedDate(undefined);
    setPage(1);
  }

  function toggleOrder() {
    setOrder(o => (o === "desc" ? "asc" : "desc"));
    setPage(1);
  }

  const displayed = posts.filter(p =>
    !search ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex-1 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="order-2 font-display text-xl font-semibold text-primary sm:order-none">Live Feed</h1>

          <div className="order-1 flex flex-wrap items-center gap-3 sm:order-none">
            <div className="order-1 flex w-full items-center gap-2 rounded-full border border-primary bg-white px-4 py-2.5 transition-colors sm:order-1 sm:w-auto sm:flex-none sm:border-accent">
              <Search size={16} className="shrink-0 text-accent" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search with Title and hashtags....."
                className="w-full bg-transparent text-sm text-primary placeholder:text-primary/70 focus:outline-none sm:w-56 sm:placeholder:text-accent/70"
              />
            </div>
            <button
              onClick={toggleOrder}
              type="button"
              className="order-2 flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95 sm:order-2"
            >
              {order === "desc" ? "Latest First" : "Oldest First"}
              <ChevronDown size={16} className={order === "desc" ? "" : "rotate-180"} />
            </button>
            <div className="relative order-3 sm:order-3">
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
                type="button"
              >
                {selectedDate
                  ? selectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  : "Date"}
                {selectedDate ? (
                  <X size={14} onClick={clearDate} />
                ) : (
                  <Calendar size={14} />
                )}
              </button>

              {showDatePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                  {/* Mobile: centered + clamped to the viewport so a ~300px calendar can
                      never spill off-screen regardless of where the Date button sits.
                      sm+: revert to a normal anchored dropdown under the button. */}
                  <div className="rdp-theme fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl bg-white p-3 shadow-card-hover sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-auto sm:translate-y-0">
                    <DayPicker
                      mode="single"
                      selected={selectedDate}
                      onSelect={handleSelectDate}
                      autoFocus
                    />
                  </div>
                </>
              )}
            </div>
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
            <p className="mt-1 text-sm text-muted">
              {selectedDate ? "No posts were published on this day." : "Check back later for updates from your community."}
            </p>
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
