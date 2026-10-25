"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toDateParam, type AdminPost, type ListPostsResponse } from "./types";

const PAGE_SIZE = 20;

interface PostsResult {
  query: string;
  posts: AdminPost[];
  total: number;
  totalPages: number;
}

/**
 * Filters, paging, loading and the pin/delete actions behind the admin post lists.
 *
 * The request is fully described by one query string, and the last response remembers which query
 * it answered: while a new one is in flight the old posts stay up (`refreshing`) instead of the
 * list blanking to a skeleton on every filter change. Filters reset to page 1 in the same update,
 * so a change fetches once — not the old page and then page 1.
 */
/** `postId` narrows the list to that one post (the feed opened from a notification). */
export function useAdminPosts(postId?: string) {
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [communityId, setCommunityId] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<AdminPost | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), order: sortDesc ? "desc" : "asc" });
    if (communityId) params.set("communityId", communityId);
    if (date) params.set("date", toDateParam(date));
    if (postId) params.set("postId", postId);
    return params.toString();
  }, [page, communityId, date, sortDesc, postId]);

  const [result, setResult] = useState<PostsResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick(t => t + 1);

  useEffect(() => {
    let cancelled = false;
    api.get<ListPostsResponse>(`/api/v1/posts?${query}`)
      .then(d => !cancelled && setResult({ query, posts: d.posts, total: d.total, totalPages: d.totalPages }))
      .catch(() => !cancelled && setResult({ query, posts: [], total: 0, totalPages: 1 }));
    return () => { cancelled = true; };
  }, [query, reloadTick]);

  const posts = useMemo(() => result?.posts ?? [], [result]);
  const needle = search.trim().toLowerCase();

  // Search filters the loaded page; pinned posts always lead, in their pin order.
  const displayed = useMemo(
    () =>
      posts
        .filter(p => !needle || p.title.toLowerCase().includes(needle) || p.tags.some(t => t.toLowerCase().includes(needle)))
        .slice()
        .sort((a, b) => {
          if (a.pinOrder !== null && b.pinOrder === null) return -1;
          if (a.pinOrder === null && b.pinOrder !== null) return 1;
          if (a.pinOrder !== null && b.pinOrder !== null) return a.pinOrder - b.pinOrder;
          const ta = new Date(a.publishedAt ?? a.createdAt).getTime();
          const tb = new Date(b.publishedAt ?? b.createdAt).getTime();
          return sortDesc ? tb - ta : ta - tb;
        }),
    [posts, needle, sortDesc],
  );

  async function pin(post: AdminPost) {
    if (pinningId) return;
    setPinningId(post.id);
    try {
      await api.patch(`/api/v1/posts/${post.id}/pin`, {});
      toast.success(post.pinOrder !== null ? "Post unpinned." : "Post pinned.");
      reload();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to update pin"); }
    finally { setPinningId(null); }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete Post?",
      message: "This will permanently delete the post and all its comments. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/v1/posts/${id}`);
      toast.success("Post deleted.");
      reload();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to delete post"); }
    finally { setDeletingId(null); }
  }

  return {
    // filters
    search,
    setSearch,
    sortDesc,
    toggleSort: () => setSortDesc(s => !s),
    communityId,
    changeCommunity: (id: string) => { setCommunityId(id); setPage(1); },
    date,
    changeDate: (d: Date | undefined) => { setDate(d); setPage(1); },
    hasFilters: !!needle || !!communityId || !!date,
    clearFilters: () => { setSearch(""); setCommunityId(""); setDate(undefined); setPage(1); },
    // data
    loading: result === null,
    refreshing: result !== null && result.query !== query,
    posts,
    displayed,
    total: result?.total ?? 0,
    page,
    setPage,
    totalPages: result?.totalPages ?? 1,
    reload,
    // actions
    pin,
    remove,
    deletingId,
    pinningId,
    editingPost,
    setEditingPost,
  };
}
