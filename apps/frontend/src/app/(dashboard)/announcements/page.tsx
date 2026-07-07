"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

interface Post {
  id: string;
  communityName: string;
  title: string;
  tags: string[];
  pinOrder: number | null;
  publishedAt: string | null;
  createdAt: string;
  commentCount: number;
}

interface ListPostsResponse {
  posts: Post[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function isCompanyPost(tags: string[]): boolean {
  const companyKeywords = ["fundamental", "results", "nse", "bse", "ipo", "earnings", "dividend"];
  return tags.some(t => companyKeywords.some(k => t.toLowerCase().includes(k)));
}

function AnnouncementCard({ post }: { post: Post }) {
  const official = isCompanyPost(post.tags);
  const initials = post.communityName
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const text = official
    ? "A company you follow has released new financial results."
    : `${post.communityName} shared a new market insight.`;
  const timestamp = formatRelativeTime(post.publishedAt ?? post.createdAt);

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-card">
      {official ? (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <ShieldCheck size={22} />
        </div>
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary">
          {initials}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-base text-black">{text}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-black/60">{timestamp}</span>
          <button
            type="button"
            className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold text-white"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ListPostsResponse>("/api/v1/posts?page=1&pageSize=20");
      setPosts(data.posts);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const recent = posts.filter(p => isToday(p.publishedAt ?? p.createdAt));
  const previous = posts.filter(p => !isToday(p.publishedAt ?? p.createdAt));

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-semibold text-primary">Announcement</h1>
        <button
          onClick={fetchPosts}
          type="button"
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/20"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-22 animate-pulse rounded-2xl bg-white shadow-card" />
          ))}
        </div>
      ) : (
        <>
          {/* Recent */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-primary">Recent</h2>
              {recent.length > 0 && (
                <span className="h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
              )}
            </div>
            {recent.length === 0 ? (
              <p className="text-sm text-muted">No new announcements today.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {recent.map(post => (
                  <AnnouncementCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </section>

          {/* Divider */}
          <div className="h-0.5 bg-[#d9d9d9]" />

          {/* Previous */}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-primary">Previous</h2>
            {previous.length === 0 ? (
              <p className="text-sm text-muted">No earlier announcements.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {previous.map(post => (
                  <AnnouncementCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

