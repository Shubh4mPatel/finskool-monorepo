"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Newspaper, Plus } from "lucide-react";
import MarketTodayWidget from "@/components/MarketTodayWidget";
import CommunityRulesWidget from "@/components/CommunityRulesWidget";
import EditPostModal from "@/components/admin/posts/EditPostModal";
import PostsList, { Pagination } from "@/components/admin/posts/PostsList";
import PostsToolbar from "@/components/admin/posts/PostsToolbar";
import type { CommunityOption } from "@/components/admin/posts/types";
import { useAdminPosts } from "@/components/admin/posts/useAdminPosts";
import { api } from "@/lib/api";

// useSearchParams needs a Suspense boundary above it for the page to prerender.
export default function AdminFeedPage() {
  return (
    <Suspense>
      <FeedView />
    </Suspense>
  );
}

function FeedView() {
  // ?post=<id> (from a notification) shows just that post instead of the whole feed.
  const focusedPostId = useSearchParams().get("post") ?? undefined;
  const feed = useAdminPosts(focusedPostId);
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<CommunityOption[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  function goToPage(next: number) {
    feed.setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const communityName = communities.find(c => c.id === feed.communityId)?.name;

  return (
    <>
      {feed.editingPost && (
        <EditPostModal post={feed.editingPost} onClose={() => feed.setEditingPost(null)} onSaved={feed.reload} />
      )}

      {/* Header — spans full width, sits above both the post column and the aside so the aside can start level with the posts below */}
      <div ref={topRef} className="animate-enter mb-5 flex max-w-4xl scroll-mt-4 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Live Feed</p>
          <h1 className="font-display text-2xl font-bold text-primary">Live Feed</h1>
          <p className="mt-1 text-sm text-muted">
            {focusedPostId
              ? "Opened from a notification"
              : feed.loading
              ? "Loading posts…"
              : `${feed.total.toLocaleString("en-IN")} published post${feed.total === 1 ? "" : "s"}${communityName ? ` in ${communityName}` : ""}`}
          </p>
        </div>
        {focusedPostId ? (
          <Link
            href="/admin/feed"
            className="inline-flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:border-accent"
          >
            <ArrowLeft size={15} /> All posts
          </Link>
        ) : (
        <Link
          href="/admin/create-post"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
        >
          <Plus size={15} className="text-lime" />
          Create post
        </Link>
        )}
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main feed */}
        <div className="w-full max-w-4xl space-y-5">
          {!focusedPostId && <PostsToolbar
            search={feed.search}
            onSearch={feed.setSearch}
            communities={communities}
            communityId={feed.communityId}
            onCommunity={feed.changeCommunity}
            date={feed.date}
            onDate={feed.changeDate}
            sortDesc={feed.sortDesc}
            onToggleSort={feed.toggleSort}
            hasFilters={feed.hasFilters}
            onClear={feed.clearFilters}
          />}
          {focusedPostId && !feed.loading && feed.posts.length === 0 ? (
            <div className="animate-fade flex flex-col items-center rounded-2xl bg-white px-6 py-14 text-center shadow-card">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-subtle"><Newspaper size={22} /></span>
              <p className="mt-4 font-display text-base font-semibold text-primary">This post is no longer available</p>
              <p className="mt-1 text-sm text-muted">It may have been deleted or unpublished.</p>
            </div>
          ) : (
          <PostsList
            loading={feed.loading}
            refreshing={feed.refreshing}
            posts={feed.displayed}
            hasFilters={feed.hasFilters}
            onClearFilters={feed.clearFilters}
            deletingId={feed.deletingId}
            pinningId={feed.pinningId}
            onEdit={feed.setEditingPost}
            onDelete={feed.remove}
            onPin={feed.pin}
          />
          )}
          {!focusedPostId && <Pagination page={feed.page} totalPages={feed.totalPages} onPage={goToPage} />}
        </div>

        {/* Right sidebar — same as user feed */}
        <aside className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:w-75 lg:shrink-0 lg:grid-cols-1 lg:self-start lg:sticky lg:top-2">
          <MarketTodayWidget />
          <CommunityRulesWidget />
        </aside>
      </div>
    </>
  );
}
