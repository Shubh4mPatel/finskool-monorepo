"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Newspaper, Plus, SearchX } from "lucide-react";
import FeedPostCard from "@/components/feed/FeedPostCard";
import { Skeleton, stagger } from "@/components/admin/dashboard/Panel";
import { formatTimestamp, type AdminPost } from "./types";
import PostMenu from "./PostMenu";

function PostSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-5 h-4 w-2/3" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <Skeleton className="mt-5 aspect-video w-full rounded-xl" />
    </div>
  );
}

/** The admin post list: placeholders, empty states, and cards with their ⋯ actions. */
export default function PostsList({
  loading,
  refreshing,
  posts,
  hasFilters,
  onClearFilters,
  deletingId,
  pinningId,
  onEdit,
  onDelete,
  onPin,
}: {
  loading: boolean;
  refreshing: boolean;
  posts: AdminPost[];
  hasFilters: boolean;
  onClearFilters: () => void;
  deletingId: string | null;
  pinningId: string | null;
  onEdit: (post: AdminPost) => void;
  onDelete: (id: string) => void;
  onPin: (post: AdminPost) => void;
}) {
  if (loading) {
    return <div className="space-y-5">{[0, 1, 2].map(i => <PostSkeleton key={i} />)}</div>;
  }

  if (posts.length === 0) {
    return (
      <div className="animate-fade flex flex-col items-center justify-center rounded-2xl bg-white px-6 py-14 text-center shadow-card">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-subtle">
          {hasFilters ? <SearchX size={22} /> : <Newspaper size={22} />}
        </span>
        <p className="mt-4 font-display text-base font-semibold text-primary">
          {hasFilters ? "No posts match these filters" : "No published posts yet"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {hasFilters ? "Try a different search, community or date." : "Create and publish a post to see it here."}
        </p>
        {hasFilters ? (
          <button onClick={onClearFilters} className="mt-5 rounded-full border border-divider px-5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent">
            Clear filters
          </button>
        ) : (
          <Link href="/admin/create-post" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px">
            <Plus size={14} className="text-lime" /> Create post
          </Link>
        )}
      </div>
    );
  }

  return (
    <div
      aria-busy={refreshing}
      className={`space-y-5 transition-opacity duration-300 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}
    >
      {posts.map((post, i) => {
        const busy = deletingId === post.id || pinningId === post.id;
        return (
          <div
            key={post.id}
            style={stagger(Math.min(i, 6), 0, 60)}
            className={`animate-enter transition-opacity duration-200 ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            <FeedPostCard
              postId={post.id}
              commentCount={post.commentCount}
              communityName={post.communityName}
              communityBadgeUrl={post.communityBadgeUrl}
              authorName={post.authorName}
              authorAvatarUrl={post.authorAvatarUrl}
              badge={post.pinOrder !== null ? { label: "PINNED", icon: "pin" } : undefined}
              timestamp={formatTimestamp(post.publishedAt ?? post.createdAt)}
              title={post.title}
              body=""
              bodyHtml={post.content}
              imageUrls={post.imageUrls}
              videos={post.videos}
              reactionCounts={post.groupReactionCounts ?? post.reactionCounts ?? {}}
              reactionGroupSize={post.groupSize}
              tags={post.tags}
              isAdmin
              actions={
                <PostMenu
                  post={post}
                  busy={busy}
                  onEdit={() => onEdit(post)}
                  onDelete={() => onDelete(post.id)}
                  onPin={() => onPin(post)}
                />
              }
            />
          </div>
        );
      })}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const btn =
    "flex items-center gap-1 rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-3 pt-2">
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} className={btn}>
        <ChevronLeft size={15} /> Previous
      </button>
      <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold tabular-nums text-primary shadow-card">
        {page} <span className="text-subtle">of</span> {totalPages}
      </span>
      <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className={btn}>
        Next <ChevronRight size={15} />
      </button>
    </nav>
  );
}
