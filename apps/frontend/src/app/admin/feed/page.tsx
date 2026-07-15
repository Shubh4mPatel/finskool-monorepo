"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Code, ChevronDown, Image, Italic, MoreHorizontal, Pencil, Pin, Save, Search, Trash2, X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import FeedPostCard from "@/components/feed/FeedPostCard";
import MarketTodayWidget from "@/components/MarketTodayWidget";
import CommunityRulesWidget from "@/components/CommunityRulesWidget";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface FeedPost {
  id: string;
  communityId: string;
  communityName: string;
  communitySlug: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  imageUrls: string[];
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

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ post, onClose, onSaved }: { post: FeedPost; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(post.title);
  const [tags, setTags] = useState<string[]>(post.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(post.imageUrls[0] ?? null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({ extensions: [StarterKit], content: post.content });

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!file) return;
    setUploadingImage(true);
    try {
      const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
        `/api/v1/posts/upload-url?filename=${encodeURIComponent(file.name)}`
      );
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      setImageUrl(publicUrl);
    } catch { toast.error("Failed to upload image."); }
    finally { setUploadingImage(false); }
  }

  async function handleSave() {
    if (!title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      await api.patch(`/api/v1/posts/${post.id}`, { title: title.trim(), content: editor?.getHTML() ?? post.content, tags, imageUrls: imageUrl ? [imageUrl] : [] });
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-2xl flex-col gap-5 rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageChange} />
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-primary">Edit Post</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-divider/60"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Content</label>
          <div className="rounded-xl border border-divider bg-background p-3">
            <div className="mb-2 flex items-center gap-1 border-b border-divider pb-2">
              {[{ icon: Bold, a: () => editor?.chain().focus().toggleBold().run(), act: () => editor?.isActive("bold") ?? false, l: "Bold" },
                { icon: Italic, a: () => editor?.chain().focus().toggleItalic().run(), act: () => editor?.isActive("italic") ?? false, l: "Italic" },
                { icon: Code, a: () => editor?.chain().focus().toggleCode().run(), act: () => editor?.isActive("code") ?? false, l: "Code" },
              ].map(({ icon: Icon, a, act, l }) => (
                <button key={l} type="button" onClick={a} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors ${act() ? "bg-primary text-white" : "text-muted hover:bg-divider/60"}`}><Icon size={13} /></button>
              ))}
            </div>
            <EditorContent editor={editor} className="min-h-30 text-sm text-primary [&_.ProseMirror]:outline-none" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Image</label>
          {imageUrl ? (
            <div className="relative overflow-hidden rounded-xl border border-divider">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" className="max-h-48 w-full object-cover" />
              <button onClick={() => setImageUrl(null)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-primary shadow hover:bg-white"><X size={13} /></button>
            </div>
          ) : (
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-background py-5 text-sm font-semibold text-muted hover:border-accent hover:text-primary disabled:opacity-50">
              <Image size={16} />{uploadingImage ? "Uploading…" : "Add Image"}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Tags</label>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-background px-3 py-2.5">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-0.5 text-xs font-medium text-primary">
                {tag}<button type="button" onClick={() => setTags(t => t.filter(x => x !== tag))} className="text-subtle hover:text-primary"><X size={10} /></button>
              </span>
            ))}
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} placeholder="Add tag…" className="min-w-20 flex-1 bg-transparent text-xs text-subtle focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-muted hover:text-primary">Cancel</button>
          <button onClick={handleSave} disabled={saving || uploadingImage}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow disabled:opacity-60">
            <Save size={14} />{saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Three-dot post menu ──────────────────────────────────────────────────────

function PostMenu({ post, onEdit, onDelete, onPin }: { post: FeedPost; onEdit: () => void; onDelete: () => void; onPin: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = post.pinOrder !== null;

  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function item(onClick: () => void, icon: React.ReactNode, label: string, danger = false) {
    return (
      <button onClick={() => { onClick(); setOpen(false); }}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-divider/60 ${danger ? "text-red-500" : "text-primary"}`}>
        {icon}{label}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary">
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminFeedPage() {
  const toast = useToast();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);

  const fetchPosts = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: "20" });
      const data = await api.get<ListPostsResponse>(`/api/v1/posts?${params}`);
      setPosts(data.posts);
      setTotalPages(data.totalPages);
    } catch { setPosts([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPosts(page); }, [fetchPosts, page]);

  async function handlePin(post: FeedPost) {
    if (pinningId) return;
    setPinningId(post.id);
    try {
      await api.patch(`/api/v1/posts/${post.id}/pin`, { pinOrder: post.pinOrder !== null ? null : 1 });
      toast.success(post.pinOrder !== null ? "Post unpinned." : "Post pinned.");
      fetchPosts(page);
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to update pin"); }
    finally { setPinningId(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this post?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/v1/posts/${id}`);
      toast.success("Post deleted.");
      fetchPosts(page);
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Failed to delete"); }
    finally { setDeletingId(null); }
  }

  const displayed = posts
    .filter(p => !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.tags.some(t => t.toLowerCase().includes(search.toLowerCase())))
    .slice()
    .sort((a, b) => {
      if (a.pinOrder !== null && b.pinOrder === null) return -1;
      if (a.pinOrder === null && b.pinOrder !== null) return 1;
      if (a.pinOrder !== null && b.pinOrder !== null) return a.pinOrder - b.pinOrder;
      const ta = new Date(a.publishedAt ?? a.createdAt).getTime();
      const tb = new Date(b.publishedAt ?? b.createdAt).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });

  return (
    <>
      {editingPost && (
        <EditModal post={editingPost} onClose={() => setEditingPost(null)} onSaved={() => fetchPosts(page)} />
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Main feed */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="font-display text-2xl font-bold text-primary">Live Feed</h1>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 transition-colors focus-within:border-accent sm:flex-none">
                <Search size={16} className="text-subtle shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search with Title and hashtags..."
                  className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-52" />
              </div>
              <button onClick={() => setSortDesc(p => !p)}
                className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
                {sortDesc ? "Latest First" : "Oldest First"}
                <ChevronDown size={16} className={sortDesc ? "" : "rotate-180"} />
              </button>
            </div>
          </div>

          {/* Posts */}
          {loading ? (
            <div className="space-y-5">{[0, 1, 2].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-white shadow-card" />)}</div>
          ) : displayed.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-2xl bg-white shadow-card">
              <p className="font-display text-base font-semibold text-primary">No published posts yet</p>
              <p className="mt-1 text-sm text-muted">Create and publish a post to see it here.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {displayed.map(post => (
                <FeedPostCard
                  key={post.id}
                  postId={post.id}
                  commentCount={post.commentCount}
                  communityName={post.communityName}
                  authorName={post.authorName}
                  authorAvatarUrl={post.authorAvatarUrl}
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
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">Previous</button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">Next</button>
            </div>
          )}
        </div>

        {/* Right sidebar — same as user feed */}
        <aside className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:w-75 lg:shrink-0 lg:grid-cols-1 lg:self-start lg:sticky lg:top-6">
          <MarketTodayWidget />
          <CommunityRulesWidget />
        </aside>
      </div>
    </>
  );
}
