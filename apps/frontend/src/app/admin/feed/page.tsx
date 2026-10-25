"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PostVideo } from "@/lib/post-videos";
import {
  ArrowDownUp,
  Bold,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  Italic,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Pin,
  Plus,
  Save,
  Search,
  SearchX,
  Trash2,
  X,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import FeedPostCard from "@/components/feed/FeedPostCard";
import PostMediaPicker from "@/components/admin/PostMediaPicker";
import { toVideoInput } from "@/lib/post-videos";
import MarketTodayWidget from "@/components/MarketTodayWidget";
import CommunityRulesWidget from "@/components/CommunityRulesWidget";
import { Skeleton, stagger } from "@/components/admin/dashboard/Panel";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Community {
  id: string;
  name: string;
  slug: string;
}

interface FeedPost {
  id: string;
  communityId: string;
  communityName: string;
  communitySlug: string;
  communityBadgeUrl: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  imageUrls: string[];
  videos?: PostVideo[];
  reactionCounts?: Record<string, number>;
  groupReactionCounts?: Record<string, number>;
  groupSize?: number;
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

const PAGE_SIZE = 20;

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

/** Closes a popover/dialog on Escape while `active`. */
function useEscape(active: boolean, onEscape: () => void) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && handler.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

const fieldClass =
  "w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary transition-all focus:border-accent focus:bg-white focus:outline-none focus:ring-4 focus:ring-accent/10";

// Secondary toolbar control: white pill; `active` tints it when it is filtering the list.
const controlClass = (active: boolean) =>
  `flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all ${
    active
      ? "border-accent/40 bg-accent/10 text-primary"
      : "border-divider bg-white text-muted hover:border-subtle hover:text-primary"
  }`;

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ post, onClose, onSaved }: { post: FeedPost; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(post.title);
  const [tags, setTags] = useState<string[]>(post.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>(post.imageUrls);
  const [videos, setVideos] = useState<PostVideo[]>(post.videos ?? []);

  const editor = useEditor({ extensions: [StarterKit], content: post.content });
  useEscape(!saving, onClose);

  async function handleSave() {
    if (!title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      await api.patch(`/api/v1/posts/${post.id}`, { title: title.trim(), content: editor?.getHTML() ?? post.content, tags, imageUrls, videos: videos.map(toVideoInput) });
      toast.success("Post updated.");
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to update post"); }
    finally { setSaving(false); }
  }

  function addTag(e: React.KeyboardEvent) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().startsWith("#") ? tagInput.trim() : `#${tagInput.trim()}`;
      setTags(prev => [...prev, t]); setTagInput("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade absolute inset-0 bg-primary/30 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-post-title"
        className="animate-enter relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <div>
            <h2 id="edit-post-title" className="font-display text-lg font-bold text-primary">Edit Post</h2>
            <p className="text-xs text-muted">In {post.communityName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-post-headline" className="text-xs font-semibold text-muted">Title</label>
            <input id="edit-post-headline" value={title} onChange={e => setTitle(e.target.value)} className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">Content</p>
            <div className="rounded-xl border border-divider bg-background p-3 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              <div className="mb-2 flex items-center gap-1 border-b border-divider pb-2">
                {[{ icon: Bold, a: () => editor?.chain().focus().toggleBold().run(), act: () => editor?.isActive("bold") ?? false, l: "Bold" },
                  { icon: Italic, a: () => editor?.chain().focus().toggleItalic().run(), act: () => editor?.isActive("italic") ?? false, l: "Italic" },
                  { icon: Code, a: () => editor?.chain().focus().toggleCode().run(), act: () => editor?.isActive("code") ?? false, l: "Code" },
                ].map(({ icon: Icon, a, act, l }) => (
                  <button key={l} type="button" onClick={a} title={l} aria-label={l} aria-pressed={act()} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors ${act() ? "bg-primary text-white" : "text-muted hover:bg-divider/60"}`}><Icon size={13} /></button>
                ))}
              </div>
              <EditorContent editor={editor} className="min-h-30 text-sm text-primary [&_.ProseMirror]:outline-none" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">Media</p>
            <PostMediaPicker imageUrls={imageUrls} onImageUrlsChange={setImageUrls} videos={videos} onVideosChange={setVideos} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-post-tags" className="text-xs font-semibold text-muted">Tags</label>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-background px-3 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              {tags.map(tag => (
                <span key={tag} className="animate-fade flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-0.5 text-xs font-medium text-primary">
                  {tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => setTags(t => t.filter(x => x !== tag))} className="text-subtle hover:text-primary"><X size={10} /></button>
                </span>
              ))}
              <input id="edit-post-tags" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} placeholder="Add tag and press Enter…" className="min-w-20 flex-1 bg-transparent text-xs text-primary placeholder:text-subtle focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-divider px-6 py-4">
          <button onClick={onClose} className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow transition-all hover:-translate-y-px disabled:opacity-60">
            <Save size={14} />{saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Three-dot post menu ──────────────────────────────────────────────────────

function PostMenu({ post, busy, onEdit, onDelete, onPin }: {
  post: FeedPost;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = post.pinOrder !== null;
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function item(onClick: () => void, icon: React.ReactNode, label: string, danger = false) {
    return (
      <button role="menuitem" onClick={() => { onClick(); setOpen(false); }}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${danger ? "text-red-500 hover:bg-red-50" : "text-primary hover:bg-divider/60"}`}>
        {icon}{label}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        aria-label="Post actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${open ? "bg-divider text-primary" : "text-muted hover:bg-divider/60 hover:text-primary"}`}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="animate-fade absolute right-0 top-9 z-30 min-w-44 overflow-hidden rounded-2xl border border-divider bg-white py-1 shadow-xl">
          {isPinned
            ? item(onPin, <Pin size={14} className="text-accent" />, "Unpin Post")
            : item(onPin, <Pin size={14} />, "Pin Post")}
          {item(onEdit, <Pencil size={14} />, "Edit Post")}
          <div className="my-1 h-px bg-divider" />
          {item(onDelete, <Trash2 size={14} />, "Delete Post", true)}
        </div>
      )}
    </div>
  );
}

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

// ── Page ─────────────────────────────────────────────────────────────────────

interface FeedResult {
  query: string;
  posts: FeedPost[];
  total: number;
  totalPages: number;
}

export default function AdminFeedPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [filterCommunity, setFilterCommunity] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [showDatePicker, setShowDatePicker] = useState(false);
  useEscape(showDatePicker, () => setShowDatePicker(false));
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  // The request is fully described by this query string. The last response remembers which query
  // it answered, so while a new one is in flight the old posts stay up (dimmed) instead of the page
  // blanking to a skeleton on every filter change.
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), order: sortDesc ? "desc" : "asc" });
    if (filterCommunity) params.set("communityId", filterCommunity);
    if (selectedDate) params.set("date", toDateParam(selectedDate));
    return params.toString();
  }, [page, filterCommunity, selectedDate, sortDesc]);

  const [result, setResult] = useState<FeedResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick(t => t + 1);

  useEffect(() => {
    let cancelled = false;
    api.get<ListPostsResponse>(`/api/v1/posts?${query}`)
      .then(d => !cancelled && setResult({ query, posts: d.posts, total: d.total, totalPages: d.totalPages }))
      .catch(() => !cancelled && setResult({ query, posts: [], total: 0, totalPages: 1 }));
    return () => { cancelled = true; };
  }, [query, reloadTick]);

  const loading = result === null;
  const refreshing = result !== null && result.query !== query;
  const posts = useMemo(() => result?.posts ?? [], [result]);
  const totalPages = result?.totalPages ?? 1;

  // Filters reset to page 1 in the same update — previously an effect did this afterwards,
  // which fetched the old page first and then page 1.
  function changeCommunity(id: string) {
    setFilterCommunity(id);
    setPage(1);
  }

  function handleSelectDate(date: Date | undefined) {
    setSelectedDate(date);
    setPage(1);
    setShowDatePicker(false);
  }

  function clearFilters() {
    setSearch("");
    setFilterCommunity("");
    setSelectedDate(undefined);
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handlePin(post: FeedPost) {
    if (pinningId) return;
    setPinningId(post.id);
    try {
      await api.patch(`/api/v1/posts/${post.id}/pin`, {});
      toast.success(post.pinOrder !== null ? "Post unpinned." : "Post pinned.");
      reload();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to update pin"); }
    finally { setPinningId(null); }
  }

  async function handleDelete(id: string) {
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
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to delete"); }
    finally { setDeletingId(null); }
  }

  const needle = search.trim().toLowerCase();
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

  const hasFilters = !!needle || !!filterCommunity || !!selectedDate;
  const communityName = communities.find(c => c.id === filterCommunity)?.name;

  return (
    <>
      {editingPost && (
        <EditModal post={editingPost} onClose={() => setEditingPost(null)} onSaved={reload} />
      )}

      {/* Header — spans full width, sits above both the post column and the aside so the aside can start level with the posts below */}
      <div ref={topRef} className="animate-enter mb-5 flex max-w-4xl scroll-mt-4 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Live Feed</p>
          <h1 className="font-display text-2xl font-bold text-primary">Live Feed</h1>
          <p className="mt-1 text-sm text-muted">
            {loading
              ? "Loading posts…"
              : `${result.total.toLocaleString("en-IN")} published post${result.total === 1 ? "" : "s"}${communityName ? ` in ${communityName}` : ""}`}
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

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main feed */}
        <div className="w-full max-w-4xl space-y-5">
          {/* Filters — stay in reach while scrolling a long feed */}
          <div className="sticky top-0 z-20 -mx-1 bg-background/85 px-1 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white p-2.5 shadow-card ring-1 ring-primary/[0.04]">
              <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
                <Search size={16} className="shrink-0 text-subtle" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search titles and #tags on this page"
                  aria-label="Search posts"
                  className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="relative shrink-0">
                <select
                  value={filterCommunity}
                  onChange={e => changeCommunity(e.target.value)}
                  aria-label="Community"
                  className={`${controlClass(!!filterCommunity)} appearance-none pr-9 focus:outline-none`}
                >
                  <option value="">All communities</option>
                  {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle" />
              </div>

              <div className="relative flex shrink-0 items-center">
                <button
                  onClick={() => setShowDatePicker(v => !v)}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={showDatePicker}
                  className={`${controlClass(!!selectedDate)} ${selectedDate ? "pr-9" : ""}`}
                >
                  <Calendar size={14} />
                  {selectedDate ? selectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Any date"}
                </button>
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => handleSelectDate(undefined)}
                    aria-label="Clear date"
                    className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-white hover:text-primary"
                  >
                    <X size={12} />
                  </button>
                )}

                {showDatePicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                    <div className="rdp-theme animate-fade fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl bg-white p-3 shadow-card-hover sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-auto sm:translate-y-0">
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

              <button
                type="button"
                onClick={() => setSortDesc(p => !p)}
                aria-label={sortDesc ? "Sorted newest first. Switch to oldest first" : "Sorted oldest first. Switch to newest first"}
                className={controlClass(false)}
              >
                <ArrowDownUp size={14} />
                {sortDesc ? "Newest first" : "Oldest first"}
              </button>

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Posts */}
          {loading ? (
            <div className="space-y-5">{[0, 1, 2].map(i => <PostSkeleton key={i} />)}</div>
          ) : displayed.length === 0 ? (
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
                <button onClick={clearFilters} className="mt-5 rounded-full border border-divider px-5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent">
                  Clear filters
                </button>
              ) : (
                <Link href="/admin/create-post" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px">
                  <Plus size={14} className="text-lime" /> Create post
                </Link>
              )}
            </div>
          ) : (
            <div
              aria-busy={refreshing}
              className={`space-y-5 transition-opacity duration-300 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}
            >
              {displayed.map((post, i) => {
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
                          onEdit={() => setEditingPost(post)}
                          onDelete={() => handleDelete(post.id)}
                          onPin={() => handlePin(post)}
                        />
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-center gap-3 pt-2">
              <button onClick={() => goToPage(Math.max(1, page - 1))} disabled={page === 1}
                className="flex items-center gap-1 rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">
                <ChevronLeft size={15} /> Previous
              </button>
              <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold tabular-nums text-primary shadow-card">
                {page} <span className="text-subtle">of</span> {totalPages}
              </span>
              <button onClick={() => goToPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                className="flex items-center gap-1 rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">
                Next <ChevronRight size={15} />
              </button>
            </nav>
          )}
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
