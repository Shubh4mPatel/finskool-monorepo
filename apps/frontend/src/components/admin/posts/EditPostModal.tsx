"use client";

import { useState } from "react";
import { Bold, Code, Italic, Save, X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import PostMediaPicker from "@/components/admin/PostMediaPicker";
import { toVideoInput, type PostVideo } from "@/lib/post-videos";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { AdminPost } from "./types";
import { useEscape } from "./useEscape";

export const fieldClass =
  "w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary transition-all focus:border-accent focus:bg-white focus:outline-none focus:ring-4 focus:ring-accent/10";

export default function EditPostModal({ post, onClose, onSaved }: { post: AdminPost; onClose: () => void; onSaved: () => void }) {
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
            <input id="edit-post-headline" value={title} onChange={e => setTitle(e.target.value)} placeholder="Post headline…" className={fieldClass} />
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
              <EditorContent editor={editor} className="min-h-30 text-sm text-primary [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-1" />
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
