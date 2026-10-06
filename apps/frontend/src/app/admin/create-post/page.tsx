"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TiptapLink from "@tiptap/extension-link";
import { ArrowRight, Bold, Check, ChevronLeft, Code, Italic, LayoutGrid, Link, List, ListOrdered, Pencil, Users, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { getSession } from "@/lib/session";
import PostMediaPicker from "@/components/admin/PostMediaPicker";
import { toVideoInput, type PostVideo } from "@/lib/post-videos";
import FeedPostCard from "@/components/feed/FeedPostCard";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";

type Step = 1 | 2 | 3;

interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  badgeUrl: string | null;
  type: string | null;
  isFree: boolean;
  memberCount: number;
}

// The free community is the open Feed every registered user can see, so the UI
// presents it as "Feed" rather than as a community.
function targetName(c: Community): string {
  return c.isFree ? "Feed" : c.name;
}

function CheckBox({ checked, className = "" }: { checked: boolean; className?: string }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors ${
        checked ? "border-accent bg-accent text-white" : "border-white bg-white/90 text-transparent"
      } ${className}`}
    >
      <Check size={12} strokeWidth={3} />
    </span>
  );
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

  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string) ?? "";
    const url = window.prompt("Enter URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const tools = [
    { icon: Bold,        action: () => editor.chain().focus().toggleBold().run(),             active: editor.isActive("bold"),                  label: "Bold" },
    { icon: Italic,      action: () => editor.chain().focus().toggleItalic().run(),           active: editor.isActive("italic"),                label: "Italic" },
    { icon: List,        action: () => editor.chain().focus().toggleBulletList().run(),       active: editor.isActive("bulletList"),             label: "Bullet List" },
    { icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(),      active: editor.isActive("orderedList"),            label: "Numbered List" },
    { icon: Link,        action: setLink,                                                     active: editor.isActive("link"),                   label: "Link" },
    { icon: Code,        action: () => editor.chain().focus().toggleCode().run(),             active: editor.isActive("code"),                   label: "Code" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-background px-2 py-1.5">
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [headline, setHeadline] = useState("");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [tagInput, setTagInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  // Links the copies made by one publish so the admin side can show their reactions together.
  // Kept across a retry of failed targets (so late copies still join the group), cleared on success.
  const groupIdRef = useRef<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videos, setVideos] = useState<PostVideo[]>([]);

  const [communities, setCommunities] = useState<Community[]>([]);
  const feed = communities.find((c) => c.isFree);
  const paidCommunities = communities.filter((c) => !c.isFree);
  // Keep the order of the grid (Feed first) rather than the order of clicking.
  const targets = communities.filter((c) => selectedIds.includes(c.id)).sort((a, b) => Number(b.isFree) - Number(a.isFree));
  const allSelected = communities.length > 0 && selectedIds.length === communities.length;

  const toggleTarget = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelectedIds(allSelected ? [] : communities.map((c) => c.id));

  useEffect(() => {
    api.get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Add Description e.g. Tip: Include entry price, target, stop loss and reasoning for stock calls." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TiptapLink.configure({ openOnClick: false }),
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

  const previewBodyHtml = editor && !editor.isEmpty
    ? editor.getHTML()
    : "<p>Strong breakout above ₹1,400 resistance with high delivery volumes. Swing setup with defined risk. Enter...</p>";

  function handleContinueToReview() {
    if (!headline.trim() || !editor?.getText().trim()) {
      toast.error("Please add a headline and description before continuing.");
      return;
    }
    setStep(3);
  }

  async function handlePublish() {
    if (targets.length === 0 || !headline.trim() || !editor?.getText().trim()) {
      toast.error("Please fill in where to post, headline and content before publishing.");
      return;
    }
    setPublishing(true);
    const groupId = (groupIdRef.current ??= crypto.randomUUID());
    // One independent post per target. Targets that succeed are dropped from the
    // selection so a retry after a partial failure never creates duplicates.
    const results = await Promise.allSettled(
      targets.map(async (c) => {
        const post = await api.post<{ id: string }>("/api/v1/posts", {
          communityId: c.id,
          title: headline.trim(),
          content: editor.getHTML(),
          tags,
          imageUrls,
          videos: videos.map(toVideoInput),
          groupId,
        });
        await api.patch(`/api/v1/posts/${post.id}/publish`, {});
      }),
    );
    const failed = targets.filter((_, i) => results[i]?.status === "rejected");
    setPublishing(false);

    if (failed.length > 0) {
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
      const failedIds = failed.map((c) => c.id);
      setSelectedIds(failedIds);
      toast.error(
        `Failed to publish to ${failed.map(targetName).join(", ")}${firstError instanceof ApiError ? `: ${firstError.message}` : ""}. Press Publish to retry.`,
      );
      return;
    }

    toast.success({
      title: "Post published",
      message: `Your post is now live in ${targets.map(targetName).join(", ")}.`,
    });
    groupIdRef.current = null;
    setStep(1);
    setSelectedIds([]);
    setHeadline("");
    setTags(defaultTags);
    setImageUrls([]);
    setVideos([]);
    editor.commands.clearContent();
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
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Create Post</p>
        <h1 className="font-display text-2xl font-bold text-primary">Create New Post</h1>
        <p className="mt-1 text-sm text-muted">Follow the steps to publish a post to your community.</p>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <StepIndicator current={step} />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-primary">
                  <Pencil size={15} className="text-muted" />
                  Where should this post go?
                </h2>
                <p className="mt-1 text-sm text-muted">
                  You can publish to the open Feed, to specific communities, or to both at the same time.
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                disabled={communities.length === 0}
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-xs font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                <span className={`h-2.5 w-2.5 rounded-[3px] ${allSelected ? "bg-lime" : "bg-white"}`} />
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </div>

            {communities.length === 0 && <p className="text-sm text-muted">Loading communities…</p>}

            {feed && (
              <button
                type="button"
                onClick={() => toggleTarget(feed.id)}
                aria-pressed={selectedIds.includes(feed.id)}
                className={`flex items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors ${
                  selectedIds.includes(feed.id) ? "border-lime bg-lime/25" : "border-divider bg-lime/10 hover:border-lime"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-lime text-primary">
                  <LayoutGrid size={18} />
                </span>
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-primary">Feed</span>
                    <span className="rounded-full bg-lime px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-primary">Public</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Visible to every registered user, including free members who haven&apos;t subscribed.
                  </span>
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 ${
                    selectedIds.includes(feed.id) ? "border-accent bg-accent text-white" : "border-divider bg-white text-transparent"
                  }`}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              </button>
            )}

            {paidCommunities.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-primary">
                  <Users size={15} className="text-muted" />
                  Communities
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {paidCommunities.map((c) => {
                    const selected = selectedIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleTarget(c.id)}
                        aria-pressed={selected}
                        className={`group relative flex h-[117px] items-end overflow-hidden rounded-xl text-left text-white transition-all duration-300 hover:shadow-card-hover ${
                          selected ? "ring-2 ring-accent ring-offset-2" : ""
                        }`}
                        style={{ background: "linear-gradient(120deg, #0a5f57, #108b8b)" }}
                      >
                        {c.coverImageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        <span className="absolute inset-0 bg-gradient-to-r from-[#0a5f57]/95 via-[#0a5f57]/70 to-transparent" />
                        <CheckBox checked={selected} className="absolute right-3 top-3 z-10" />
                        <span className="absolute left-4 top-4 z-10 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white">
                          <CommunityBadgeIcon badgeUrl={c.badgeUrl} className="h-5 w-5 object-contain" />
                        </span>
                        <span className="relative z-10 flex w-full flex-col gap-1 p-4 pt-14">
                          {c.type && <span className="text-[10px] font-semibold text-white/80">{c.type}</span>}
                          <span className="font-display text-base font-bold leading-tight">{c.name}</span>
                          <span className="flex w-fit items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-primary">
                            <Users size={10} />
                            {c.memberCount} Member{c.memberCount === 1 ? "" : "s"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center justify-end gap-3 border-t border-divider pt-5">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="w-36 rounded-full border border-divider px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                onClick={() => targets.length > 0 && setStep(2)}
                disabled={targets.length === 0}
                className="flex w-44 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
              >
                Continue
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            {/* Admin profile row */}
            {(() => {
              const session = getSession();
              return (
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-white">
                    {session?.avatarUrl
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={session.avatarUrl} alt={session?.userName ?? "Admin"} className="h-full w-full object-cover" />
                      : (session?.userInitials ?? "A")
                    }
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <p className="font-display text-sm font-bold leading-tight text-primary">{session?.userName ?? "Admin"}</p>
                      <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-white">Super Admin</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted">Posting to :</span>
                      {targets.map((c) => (
                        <span key={c.id} className="flex w-fit items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                          {c.isFree ? <LayoutGrid size={11} /> : <CommunityBadgeIcon badgeUrl={c.badgeUrl} />}{" "}
                          {c.isFree ? "Feed" : `${c.name}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Headline */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="post-headline" className="text-sm font-bold text-primary">Headline</label>
              <input
                id="post-headline"
                type="text"
                placeholder="Add a headline e.g. TATASTEEL breakout confirmed, target ₹175"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full rounded-xl border border-divider bg-background px-4 py-3 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none transition-colors"
              />
            </div>

            {/* Editor */}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-bold text-primary">Post Body</p>
              <div className="rounded-xl border border-divider bg-white px-3 pt-3 pb-2">
                <TipTapToolbar editor={editor} />
                <EditorContent
                  editor={editor}
                  className="mt-3 min-h-32 px-1 text-sm text-primary [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-32 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_li]:my-0.5 [&_.ProseMirror_a]:text-accent [&_.ProseMirror_a]:underline [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none"
                />
              </div>
            </div>

            {/* Media / Video */}
            <PostMediaPicker imageUrls={imageUrls} onImageUrlsChange={setImageUrls} videos={videos} onVideosChange={setVideos} />

            {/* Tags */}
            <div>
              <p className="mb-1.5 text-sm font-bold text-primary">Add tags</p>
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
            <div className="mt-2 flex items-center justify-center gap-3 border-t border-divider pt-5">
              <button onClick={() => setStep(1)}
                className="w-36 rounded-full border border-divider px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary">
                Cancel
              </button>
              <button onClick={handleContinueToReview}
                className="flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
                style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}>
                Continue to review →
              </button>
            </div>

            <button onClick={() => setStep(1)} className="flex items-center gap-1 self-start text-xs font-semibold text-muted transition-colors hover:text-primary">
              <ChevronLeft size={13} /> Back to Step 1
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-6">
            <div>
              <span className="rounded-full bg-lime/40 px-3 py-1 text-xs font-bold text-primary">Post preview</span>
              <p className="mt-3 text-xs text-muted">
                Will be published to: <span className="font-semibold text-primary">{targets.map(targetName).join(", ")}</span>
              </p>
              <div className="mt-4">
                {(() => {
                  const session = getSession();
                  return (
                    <FeedPostCard
                      communityName={targets[0] ? targetName(targets[0]) : undefined}
                      communityBadgeUrl={targets[0]?.badgeUrl}
                      authorName={session?.userName ?? "Admin"}
                      authorAvatarUrl={session?.avatarUrl}
                      timestamp=""
                      title={headline || "RELIANCE — Breakout swing setup. Target ₹1,575"}
                      body=""
                      bodyHtml={previewBodyHtml}
                      imageUrls={imageUrls}
                      videos={videos}
                      tags={tags}
                    />
                  );
                })()}
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
                  className="flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
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
    </div>
  );
}
