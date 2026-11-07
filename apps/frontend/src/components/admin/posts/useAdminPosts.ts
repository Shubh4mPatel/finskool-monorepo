"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toDateParam, type AdminPost, type ListPostsResponse } from "./types";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface PostsResult {
  query: string;
  posts: AdminPost[];
  total: number;
  // Where the next batch starts; null once everything has been loaded.
  nextCursor: string | null;
}

const fetchPage = (query: string, cursor?: string | null) =>
  api.get<ListPostsResponse>(`/api/v1/posts?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);

/**
 * Filters, scrolling, loading and the pin/delete actions behind the admin post lists.
 *
 * The list loads by cursor: the first request returns the first batch, and `loadMore` (fired as the end of the
 * list scrolls into view) appends the next. The filters make up one query string, and the loaded posts remember
 * which query they answered: while a new one is in flight the old posts stay up (`refreshing`) instead of the
 * list blanking to a skeleton on every filter change.
 */
/** `postId` narrows the list to that one post (the feed opened from a notification). */
export function useAdminPosts(postId?: string) {
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState("");
  // What the server is asked for: typing doesn't fire a request per keystroke.
  const [searchTerm, setSearchTerm] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [communityId, setCommunityId] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<AdminPost | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), order: sortDesc ? "desc" : "asc" });
    if (communityId) params.set("communityId", communityId);
    if (date) params.set("date", toDateParam(date));
    if (postId) params.set("postId", postId);
    if (searchTerm) params.set("search", searchTerm);
    return params.toString();
  }, [communityId, date, sortDesc, postId, searchTerm]);

  const [result, setResult] = useState<PostsResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Bumped whenever the list is replaced or edited, so a "load more" already on its way cannot append a batch
  // fetched before that (a deleted post would come back, a replaced list would get the old query's posts).
  const generation = useRef(0);

  // The first batch, and again whenever the filters change.
  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    fetchPage(query)
      .then(d => {
        if (cancelled) return;
        setResult({ query, posts: d.posts, total: d.total ?? d.posts.length, nextCursor: d.nextCursor });
        setLoadMoreFailed(false);
      })
      .catch(() => !cancelled && setResult({ query, posts: [], total: 0, nextCursor: null }));
    return () => { cancelled = true; };
  }, [query]);

  const posts = useMemo(() => result?.posts ?? [], [result]);
  // Nothing more to fetch for a list that is already being replaced by a newer query.
  const hasMore = !!result?.nextCursor && result.query === query;

  const loadMore = useCallback(async () => {
    if (!result?.nextCursor || result.query !== query || loadingMore) return;
    const { query: asked, nextCursor } = result;
    const started = generation.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchPage(asked, nextCursor);
      if (started !== generation.current) return;
      setResult(prev => {
        if (!prev || prev.query !== asked) return prev;
        const seen = new Set(prev.posts.map(p => p.id));
        return { ...prev, posts: [...prev.posts, ...next.posts.filter(p => !seen.has(p.id))], nextCursor: next.nextCursor };
      });
    } catch {
      if (started === generation.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [result, query, loadingMore]);

  /**
   * Fetches what is on screen again, from the top through as many batches as were loaded, and swaps it in. The
   * list refreshes in place — after an edit or a pin the reader keeps their scroll position instead of being
   * cut back to the first batch. A failed refresh leaves the list as it was.
   */
  const reload = useCallback(async () => {
    if (!result || result.query !== query) return;
    const { query: asked, posts: shown } = result;
    const started = ++generation.current;
    try {
      let fetched: AdminPost[] = [];
      let cursor: string | null = null;
      let total = result.total;
      do {
        const batch: ListPostsResponse = await fetchPage(asked, cursor);
        fetched = [...fetched, ...batch.posts];
        cursor = batch.nextCursor;
        if (batch.total !== undefined) total = batch.total;
      } while (cursor && fetched.length < shown.length);
      if (started !== generation.current) return;
      setResult({ query: asked, posts: fetched, total, nextCursor: cursor });
      setLoadMoreFailed(false);
    } catch {
      // keep what is on screen
    }
  }, [result, query]);

  async function pin(post: AdminPost) {
    if (pinningId) return;
    setPinningId(post.id);
    try {
      await api.patch(`/api/v1/posts/${post.id}/pin`, {});
      toast.success(post.pinOrder !== null ? "Post unpinned." : "Post pinned.");
      await reload();
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
      // Dropped from the list here rather than refetched: the cursor is a position in the order, not a row,
      // so the rest of the list carries on from where it was.
      generation.current += 1;
      setResult(prev => prev && { ...prev, posts: prev.posts.filter(p => p.id !== id), total: Math.max(0, prev.total - 1) });
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
    changeCommunity: setCommunityId,
    date,
    changeDate: setDate,
    hasFilters: !!search.trim() || !!communityId || !!date,
    clearFilters: () => { setSearch(""); setSearchTerm(""); setCommunityId(""); setDate(undefined); },
    // data
    loading: result === null,
    refreshing: result !== null && result.query !== query,
    posts,
    total: result?.total ?? 0,
    hasMore,
    loadingMore,
    loadMoreFailed,
    loadMore,
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
