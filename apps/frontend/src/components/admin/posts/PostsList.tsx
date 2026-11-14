"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Newspaper, Plus, SearchX } from "lucide-react";
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

/** The nearest ancestor that scrolls — the admin pages scroll inside <main>, not the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

/**
 * The end of the list. The next batch loads when this comes within a screen of view, so it is usually there
 * before the reader reaches it. The observer is set up afresh after every batch, so if the new posts still do
 * not fill the screen it fires again. After a failure it waits for Retry rather than hammering the server.
 */
function LoadMore({
  hasMore,
  loading,
  failed,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onLoadMore: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasMore || loading || failed) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) onLoadMore();
      },
      { root: scrollParent(end), rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasMore, loading, failed, onLoadMore]);

  return (
    <>
      {loading && <PostSkeleton />}
      <div ref={endRef} aria-hidden className="h-px" />
      {failed && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted" role="status">
          Couldn&apos;t load more posts.
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-primary transition-colors hover:border-accent"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}

/** The admin post list: placeholders, empty states, and cards with their ⋯ actions. More posts load as the end scrolls into view. */
export default function PostsList({
  loading,
  refreshing,
  posts,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
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
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
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
            // Cycles rather than caps, so posts that load in later batches don't all wait out the longest delay.
            style={stagger(i % 6, 0, 60)}
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
              imageRatios={post.images ? Object.fromEntries(post.images.map(i => [i.url, i.ratio])) : undefined}
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
      <LoadMore hasMore={hasMore} loading={loadingMore} failed={loadMoreFailed} onLoadMore={onLoadMore} />
    </div>
  );
}
