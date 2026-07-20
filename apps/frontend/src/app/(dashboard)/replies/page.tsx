"use client";

import { useCallback, useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import FeedPostCard from "@/components/feed/FeedPostCard";
import { api } from "@/lib/api";

interface CommentedPost {
  id: string;
  communityId: string;
  communityName: string;
  communitySlug: string;
  title: string;
  content: string;
  imageUrls: string[];
  tags: string[];
  pinOrder: number | null;
  publishedAt: string | null;
  createdAt: string;
  commentCount: number;
  lastCommentedAt: string;
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

export default function RepliesPage() {
  const [posts, setPosts] = useState<CommentedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<CommentedPost[]>("/api/v1/posts/my-comments")
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-primary">My Threads</h1>

      {loading ? (
        <div className="space-y-5">
          {[0, 1].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-white shadow-card" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="animate-rise flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-divider bg-white p-16 text-center shadow-card">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/50 to-accent/10 text-primary shadow-glow">
            <MessagesSquare size={26} />
          </div>
          <p className="font-display text-lg font-bold text-primary">No replies yet</p>
          <p className="max-w-sm text-sm text-muted">
            Replies you post on the live feed and discussion threads will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              postId={post.id}
              commentCount={post.commentCount}
              communityName={post.communityName}
              timestamp={formatTimestamp(post.lastCommentedAt)}
              title={post.title}
              body=""
              bodyHtml={post.content}
              imageUrls={post.imageUrls}
              tags={post.tags}
              defaultThreadsOpen
              onThreadsChange={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
