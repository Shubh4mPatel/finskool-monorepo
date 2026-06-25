"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { ArrowRight, Bold, Check, ChevronLeft, Code, Image, Italic, Link, List, AlignLeft, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { getSession } from "@/lib/session";

type Step = 1 | 2 | 3;

interface Community { id: string; name: string; slug: string }

const COMMUNITY_COLORS = ["bg-primary/10", "bg-accent/10", "bg-lime/30", "bg-amber-100"];
function communityBg(index: number): string {
  return COMMUNITY_COLORS[index % COMMUNITY_COLORS.length] ?? "bg-divider";
}

const steps = [
  { n: 1, label: "Community & Type" },
  { n: 2, label: "Write Content" },
  { n: 3, label: "Review & Publish" },
];

const defaultTags: string[] = [];

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors duration-300 ${
                current > s.n
                  ? "bg-primary text-white"
                  : current === s.n
                  ? "bg-primary text-white ring-4 ring-primary/20"
                  : "bg-divider text-subtle"
              }`}
            >
              {current > s.n ? <Check size={14} /> : s.n}
            </div>
            <span className={`mt-1.5 hidden text-xs font-semibold sm:block ${current === s.n ? "text-primary" : "text-subtle"}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`mx-3 h-px w-16 sm:w-24 transition-colors duration-300 ${current > s.n ? "bg-primary" : "bg-divider"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function TipTapToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const tools = [
    { icon: Bold,     action: () => editor.chain().focus().toggleBold().run(),         active: editor.isActive("bold"),         label: "Bold" },
    { icon: Italic,   action: () => editor.chain().focus().toggleItalic().run(),       active: editor.isActive("italic"),       label: "Italic" },
    { icon: List,     action: () => editor.chain().focus().toggleBulletList().run(),   active: editor.isActive("bulletList"),   label: "Bullet List" },
    { icon: AlignLeft,action: () => {},                                                active: false,                           label: "Align" },
    { icon: Link,     action: () => {},                                                active: false,                           label: "Link" },
    { icon: Code,     action: () => editor.chain().focus().toggleCode().run(),         active: editor.isActive("code"),         label: "Code" },
  ];
  return (
    <div className="flex items-center gap-0.5 border-b border-divider pb-2.5">
      {tools.map(({ icon: Icon, action, active, label }) => (
        <button key={label} type="button" onClick={action} title={label}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted hover:bg-divider/60 hover:text-primary"}`}>
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

export default function CreatePostPage() {
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null);
  const [headline, setHeadline] = useState("");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [tagInput, setTagInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [communities, setCommunities] = useState<Community[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Add Description e.g. Tip: Include entry price, target, stop loss and reasoning for stock calls." }),
    ],
    editorProps: {
      attributes: { class: "outline-none" },
    },
  });

  useEffect(() => {
    if (step === 2 && editor) {
      setTimeout(() => editor.commands.focus("start"), 50);
    }
  }, [step, editor]);

  const previewContent = editor?.getText() || "Strong breakout above ₹1,400 resistance with high delivery volumes. Swing setup with defined risk. Enter...";

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!imageInputRef.current) return;
    imageInputRef.current.value = "";
    if (!file) return;

    setUploadingImage(true);
    try {
      const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
        `/api/v1/posts/upload-url?filename=${encodeURIComponent(file.name)}`
      );
      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setImageUrl(publicUrl);
    } catch {
      toast.error("Failed to upload image. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handlePublish() {
    if (!selectedCommunity || !headline.trim() || !editor?.getText().trim()) {
      toast.error("Please fill in community, headline and content before publishing.");
      return;
    }
    setPublishing(true);
    try {
      const post = await api.post<{ id: string }>("/api/v1/posts", {
        communityId: selectedCommunity,
        title: headline.trim(),
        content: editor.getHTML(),
        tags,
        imageUrls: imageUrl ? [imageUrl] : [],
      });
      await api.patch(`/api/v1/posts/${post.id}/publish`, {});
      toast.success({ title: "Post published", message: "Your post is now live in the community." });
      setStep(1);
      setSelectedCommunity(null);
      setHeadline("");
      setTags(defaultTags);
      setImageUrl(null);
      editor.commands.clearContent();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish post");
    } finally {
      setPublishing(false);
    }
  }

  const addTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      const t = tagInput.trim().startsWith("#") ? tagInput.trim() : `#${tagInput.trim()}`;
      setTags((prev) => [...prev, t]);
      setTagInput("");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleImageFileChange}
      />

      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Create Post</p>
        <h1 className="font-display text-2xl font-bold text-primary">Create New Post</h1>
        <p className="mt-1 text-sm text-muted">Follow the steps to publish a post to your community.</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <StepIndicator current={step} />

        {step === 1 && (
          <div className="mt-8 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-primary">Which community is this post for?</h2>
            <p className="text-sm text-muted">Members of the other community will not see this post.</p>
            {communities.length === 0 && (
              <p className="text-sm text-muted">Loading communities…</p>
            )}
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {communities.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCommunity(c.id)}
                  className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all duration-300 ${
                    selectedCommunity === c.id ? "border-primary shadow-glow" : "border-transparent hover:border-divider"
                  }`}
                >
                  <div className={`relative flex h-36 items-center justify-center ${communityBg(idx)}`}>
                    {selectedCommunity === c.id && (
                      <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <span className="font-display text-3xl font-bold text-primary/20">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="font-display font-bold text-primary">{c.name}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => selectedCommunity && setStep(2)}
                disabled={!selectedCommunity}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 flex flex-col gap-4">
            {/* Admin profile row */}
            {(() => {
              const session = getSession();
              return (
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                    {session?.userInitials ?? "A"}
                  </div>
                  <div>
                    <p className="font-display text-sm font-bold text-primary leading-tight">
                      {session?.userName ?? "Admin"}
                    </p>
                    <p className="text-xs text-muted">Super Admin</p>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-accent/50 px-3 py-1 text-xs font-semibold text-accent">
                    ⚡ {communities.find((c) => c.id === selectedCommunity)?.name ?? "Community"}
                  </span>
                </div>
              );
            })()}

            {/* Headline */}
            <input
              type="text"
              placeholder="Add a headline e.g. TATASTEEL breakout confirmed, target ₹175"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full rounded-xl border border-divider bg-background px-4 py-3 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none transition-colors"
            />

            {/* Editor */}
            <div className="rounded-xl border border-divider bg-background px-4 pt-3 pb-2">
              <TipTapToolbar editor={editor} />
              <EditorContent
                editor={editor}
                className="mt-3 min-h-24 text-sm text-primary [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-24 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none"
              />
            </div>

            {/* Add Image */}
            {imageUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-divider">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Post image" className="max-h-48 w-full object-cover" />
                <button type="button" onClick={() => setImageUrl(null)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-primary shadow hover:bg-white">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}
                className="flex w-fit items-center gap-2 rounded-xl border border-divider bg-background px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-50">
                <Image size={15} />
                {uploadingImage ? "Uploading…" : "Add Image"}
              </button>
            )}

            {/* Tags */}
            <div>
              <p className="mb-2 text-sm font-semibold text-primary">Add tags</p>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-background px-3 py-2.5 focus-within:border-accent transition-colors">
                {tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-divider/60 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {tag}
                    <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="text-subtle hover:text-primary">
                      <X size={9} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={addTag}
                  placeholder="#RELIANCE, #BUY, #SWING..."
                  className="min-w-24 flex-1 bg-transparent text-xs text-subtle focus:outline-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(1)}
                className="rounded-full border border-divider px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary">
                Cancel
              </button>
              <button onClick={() => setStep(3)}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">
                Continue to review →
              </button>
            </div>

            <button onClick={() => setStep(1)} className="flex items-center gap-1 self-start text-xs font-semibold text-muted transition-colors hover:text-primary">
              <ChevronLeft size={13} /> Back to Step 1
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8 flex flex-col gap-6">
            <div>
              <span className="rounded-full bg-lime/40 px-3 py-1 text-xs font-bold text-primary">Post preview</span>
              <div className="mt-4 rounded-2xl border border-divider p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">A</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-primary">Ritesh Kumar</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">ADMIN</span>
                      <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">
                        {communities.find((c) => c.id === selectedCommunity)?.name}
                      </span>
                    </div>
                  </div>
                </div>

                <h3 className="mt-4 font-display text-lg font-bold text-primary">
                  {headline || "RELIANCE — Breakout swing setup. Target ₹1,575"}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{previewContent}</p>

                {imageUrl && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-divider">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="Post image" className="max-h-48 w-full object-cover" />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-accent">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => setStep(2)} className="flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-primary">
                <ChevronLeft size={15} />
                Back to Step 2
              </button>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <button onClick={() => setStep(1)} className="rounded-full border border-divider px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary">
                  Cancel
                </button>
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check size={15} />
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
