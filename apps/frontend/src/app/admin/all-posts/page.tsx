"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import EditPostModal from "@/components/admin/posts/EditPostModal";
import PostsList, { Pagination } from "@/components/admin/posts/PostsList";
import PostsToolbar from "@/components/admin/posts/PostsToolbar";
import type { CommunityOption } from "@/components/admin/posts/types";
import { useAdminPosts } from "@/components/admin/posts/useAdminPosts";
import { api } from "@/lib/api";

export default function AllPostsPage() {
  const list = useAdminPosts();
  const [adminCommunities, setAdminCommunities] = useState<CommunityOption[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<CommunityOption[]>("/api/v1/admin/communities")
      .then(all => setAdminCommunities(all.map(c => ({ id: c.id, name: c.name, badgeUrl: c.badgeUrl, isFree: c.isFree }))))
      .catch(() => {});
  }, []);

  // The filter also offers any community that appears in the loaded posts, even if the
  // communities list doesn't include it.
  const communities = useMemo(() => {
    const merged = new Map<string, CommunityOption>(adminCommunities.map(c => [c.id, c]));
    list.posts.forEach(p => {
      if (!merged.has(p.communityId)) merged.set(p.communityId, { id: p.communityId, name: p.communityName, badgeUrl: p.communityBadgeUrl });
    });
    return Array.from(merged.values());
  }, [adminCommunities, list.posts]);

  function goToPage(next: number) {
    list.setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const communityName = communities.find(c => c.id === list.communityId)?.name;

  return (
    <>
      {list.editingPost && (
        <EditPostModal post={list.editingPost} onClose={() => list.setEditingPost(null)} onSaved={list.reload} />
      )}

      <div className="flex max-w-4xl flex-col gap-5">
        <div ref={topRef} className="animate-enter flex scroll-mt-4 flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; All Posts</p>
            <h1 className="font-display text-2xl font-bold text-primary">All Posts</h1>
            <p className="mt-1 text-sm text-muted">
              {list.loading
                ? "Loading posts…"
                : `${list.total.toLocaleString("en-IN")} post${list.total === 1 ? "" : "s"} across ${communityName ?? "every community"} — pin, edit or remove them here.`}
            </p>
          </div>
          <Link
            href="/admin/create-post"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
          >
            <Plus size={15} className="text-lime" />
            Create post
          </Link>
        </div>

        <PostsToolbar
          search={list.search}
          onSearch={list.setSearch}
          communities={communities}
          communityId={list.communityId}
          onCommunity={list.changeCommunity}
          date={list.date}
          onDate={list.changeDate}
          sortDesc={list.sortDesc}
          onToggleSort={list.toggleSort}
          hasFilters={list.hasFilters}
          onClear={list.clearFilters}
        />
        <PostsList
          loading={list.loading}
          refreshing={list.refreshing}
          posts={list.displayed}
          hasFilters={list.hasFilters}
          onClearFilters={list.clearFilters}
          deletingId={list.deletingId}
          pinningId={list.pinningId}
          onEdit={list.setEditingPost}
          onDelete={list.remove}
          onPin={list.pin}
        />
        <Pagination page={list.page} totalPages={list.totalPages} onPage={goToPage} />
      </div>
    </>
  );
}
