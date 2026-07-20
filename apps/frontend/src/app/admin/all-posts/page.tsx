"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bold, Code, Italic, MoreHorizontal, Pencil, Pin, Plus, Save, Trash2, X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import FeedPostCard from "@/components/feed/FeedPostCard";
import PostImageUploader from "@/components/admin/PostImageUploader";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface FeedPost {
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
}

interface ListPostsResponse {
  posts: FeedPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Community { id: string; name: string }

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

// ── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({
  post,
  onClose,
  onSaved,
}: {
  post: FeedPost;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(post.title);
  const [tags, setTags] = useState<string[]>(post.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>(post.imageUrls);

  const editor = useEditor({
    extensions: [StarterKit],
    content: post.content,
  });

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/v1/posts/${post.id}`, {
        title: title.trim(),
        content: editor?.getHTML() ?? post.content,
        tags,
        imageUrls,
      });
      toast.success("Post updated.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update post");
    } finally {
      setSaving(false);
    }
  }

  function addTag(e: React.KeyboardEvent) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().startsWith("#") ? tagInput.trim() : `#${tagInput.trim()}`;
      setTags(prev => [...prev, t]);
      setTagInput("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-2xl flex-col gap-5 rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-primary">Edit Post</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none"
            placeholder="Post headline..."
          />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Content</label>
          <div className="rounded-xl border border-divider bg-background p-3">
            <div className="mb-2 flex items-center gap-1 border-b border-divider pb-2">
              {[
                { icon: Bold, action: () => editor?.chain().focus().toggleBold().run(), active: () => editor?.isActive("bold") ?? false, label: "Bold" },
                { icon: Italic, action: () => editor?.chain().focus().toggleItalic().run(), active: () => editor?.isActive("italic") ?? false, label: "Italic" },
                { icon: Code, action: () => editor?.chain().focus().toggleCode().run(), active: () => editor?.isActive("code") ?? false, label: "Code" },
              ].map(({ icon: Icon, action, active, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors ${
                    active() ? "bg-primary text-white" : "text-muted hover:bg-divider/60 hover:text-primary"
                  }`}
                  title={label}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <EditorContent
              editor={editor}
              className="min-h-30 text-sm text-primary [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-1"
            />
          </div>
        </div>

        {/* Image */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Images</label>
          <PostImageUploader imageUrls={imageUrls} onChange={setImageUrls} />
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Tags</label>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-background px-3 py-2.5">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-0.5 text-xs font-medium text-primary">
                {tag}
                <button type="button" onClick={() => setTags(t => t.filter(x => x !== tag))} className="text-subtle hover:text-primary">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={addTag}
              placeholder="Add tag…"
              className="min-w-20 flex-1 bg-transparent text-xs text-subtle focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Post three-dot menu ──────────────────────────────────────────────────────

function PostMenu({
  post,
  onEdit,
  onDelete,
  onPin,
}: {
  post: FeedPost;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = post.pinOrder !== null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function item(onClick: () => void, icon: React.ReactNode, label: string, danger = false) {
    return (
      <button
        onClick={() => { onClick(); setOpen(false); }}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-divider/60 ${danger ? "text-red-500 hover:text-red-600" : "text-primary"}`}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"
        title="Options"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 min-w-40 overflow-hidden rounded-2xl border border-divider bg-white py-1 shadow-xl">
          {isPinned
            ? item(onPin, <Pin size={14} className="text-accent" />, "Unpin Post")
            : item(onPin, <Pin size={14} />, "Pin Post")}
          {item(onEdit, <Pencil size={14} />, "Edit Post")}
          {item(onDelete, <Trash2 size={14} />, "Delete Post", true)}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AllPostsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityFilter, setCommunityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  const fetchPosts = useCallback(async (pg: number, commId: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: "20" });
      if (commId) params.set("communityId", commId);
      const data = await api.get<ListPostsResponse>(`/api/v1/posts?${params}`);
      setPosts(data.posts);
      setTotalPages(data.totalPages);
      setTotal(data.total);

      const seen = new Map<string, string>();
      data.posts.forEach(p => seen.set(p.communityId, p.communityName));
      if (seen.size > 0) {
        setCommunities(prev => {
          const merged = new Map(prev.map(c => [c.id, c.name]));
          seen.forEach((name, id) => merged.set(id, name));
          return Array.from(merged.entries()).map(([id, name]) => ({ id, name }));
        });
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(page, communityFilter);
  }, [fetchPosts, page, communityFilter]);

  async function handlePin(post: FeedPost) {
    if (pinningId) return;
    setPinningId(post.id);
    try {
      await api.patch(`/api/v1/posts/${post.id}/pin`, {});
      toast.success(post.pinOrder !== null ? "Post unpinned." : "Post pinned.");
      fetchPosts(page, communityFilter);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update pin");
    } finally {
      setPinningId(null);
    }
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
      fetchPosts(page, communityFilter);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete post");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {editingPost && (
        <EditModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => fetchPosts(page, communityFilter)}
        />
      )}

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; All Posts</p>
            <h1 className="font-display text-2xl font-bold text-primary">All Posts</h1>
            <p className="mt-1 text-sm text-muted">
              {loading ? "Loading…" : `${total} published post${total !== 1 ? "s" : ""} across all communities`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {communities.length > 1 && (
              <select
                value={communityFilter}
                onChange={e => { setCommunityFilter(e.target.value); setPage(1); }}
                className="rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted focus:outline-none focus:border-accent"
              >
                <option value="">All Communities</option>
                {communities.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <Link
              href="/admin/create-post"
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
            >
              <Plus size={14} />
              Create Post
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="space-y-5">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-white shadow-card" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-2xl bg-white shadow-card">
            <p className="font-display text-base font-semibold text-primary">No published posts yet</p>
            <p className="mt-1 text-sm text-muted">Create and publish a post to see it here.</p>
            <Link
              href="/admin/create-post"
              className="mt-4 flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow"
            >
              <Plus size={14} />
              Create Post
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {posts.map(post => (
              <FeedPostCard
                key={post.id}
                communityName={post.communityName}
                badge={post.pinOrder !== null ? { label: "PINNED", icon: "pin" } : undefined}
                timestamp={formatTimestamp(post.publishedAt ?? post.createdAt)}
                title={post.title}
                body=""
                bodyHtml={post.content}
                imageUrls={post.imageUrls}
                tags={post.tags}
                actions={
                  <PostMenu
                    post={post}
                    onEdit={() => setEditingPost(post)}
                    onDelete={() => handleDelete(post.id)}
                    onPin={() => handlePin(post)}
                  />
                }
              />
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
    </>
  );
}
