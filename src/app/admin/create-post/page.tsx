"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { ArrowRight, Bold, Check, ChevronLeft, Code, Image, Italic, Link, Plus, Underline, Users, X } from "lucide-react";

type Step = 1 | 2 | 3;

const communities = [
  { id: "swing", name: "Swing Alpha", members: 312, color: "from-primary to-accent" },
  { id: "investor", name: "Investor Community", members: 248, color: "from-accent to-primary" },
];

const steps = [
  { n: 1, label: "Community & type" },
  { n: 2, label: "Style Content" },
  { n: 3, label: "Review & Publish" },
];

const defaultTags = ["#RELIANCE", "#BUY", "#SWING"];

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
            <div className={`mx-3 h-px w-16 sm:w-24 transition-colors duration-300 ${current > s.n + 1 ? "bg-primary" : "bg-divider"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function TipTapToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-divider pb-3">
      {[
        { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold"), label: "Bold" },
        { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic"), label: "Italic" },
        { icon: Underline, action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive("strike"), label: "Underline" },
        { icon: Link, action: () => {}, active: false, label: "Link" },
        { icon: Code, action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive("code"), label: "Code" },
      ].map(({ icon: Icon, action, active, label }) => (
        <button
          key={label}
          type="button"
          onClick={action}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors ${
            active ? "bg-primary text-white" : "text-muted hover:bg-divider/60 hover:text-primary"
          }`}
          title={label}
        >
          <Icon size={15} />
        </button>
      ))}
      <div className="ml-auto">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-divider px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-primary"
        >
          <Image size={13} />
          Add Image
        </button>
      </div>
    </div>
  );
}

export default function CreatePostPage() {
  const [step, setStep] = useState<Step>(1);
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null);
  const [headline, setHeadline] = useState("");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [tagInput, setTagInput] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Add Description e.g. Tip: Include entry price, target, stop loss and reasoning for stock calls." }),
    ],
  });

  const previewContent = editor?.getText() || "Strong breakout above ₹1,400 resistance with high delivery volumes. Swing setup with defined risk. Enter...";

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

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <StepIndicator current={step} />

        {step === 1 && (
          <div className="mt-8 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-primary">Which community is this post for?</h2>
            <p className="text-sm text-muted">Members of the other community will not see this post.</p>
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {communities.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCommunity(c.id)}
                  className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all duration-300 ${
                    selectedCommunity === c.id ? "border-primary shadow-glow" : "border-transparent hover:border-divider"
                  }`}
                >
                  <div className={`h-36 bg-gradient-to-br ${c.color} relative`}>
                    <div
                      className="absolute inset-0 opacity-20"
                      style={{
                        backgroundImage: "radial-gradient(circle, rgba(193,242,110,0.9) 1.5px, transparent 1.5px)",
                        backgroundSize: "18px 18px",
                      }}
                    />
                    {selectedCommunity === c.id && (
                      <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-lime">
                        <Check size={12} className="text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-display font-bold text-primary">{c.name}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <Users size={12} />
                      {c.members} members
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => selectedCommunity && setStep(2)}
                disabled={!selectedCommunity}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-bold text-lime">
                A
              </div>
              <div>
                <p className="font-display font-semibold text-primary">Ritesh Kumar</p>
                <span className="rounded-full bg-lime px-2.5 py-0.5 text-[10px] font-bold text-primary">
                  {communities.find((c) => c.id === selectedCommunity)?.name ?? "Community"}
                </span>
              </div>
            </div>

            <input
              type="text"
              placeholder="Add a headline e.g. TATASTEEL: Breakout Confirmed. Target ₹175"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full border-0 border-b border-divider bg-transparent py-2 text-sm text-primary placeholder:text-subtle focus:outline-none focus:border-accent transition-colors"
            />

            <div className="min-h-[120px]">
              <TipTapToolbar editor={editor} />
              <EditorContent
                editor={editor}
                className="mt-3 min-h-[80px] text-sm text-primary [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-primary">Add tags</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full border border-divider bg-background px-3 py-1 text-xs font-medium text-primary">
                    {tag}
                    <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="text-subtle hover:text-primary">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={addTag}
                  placeholder="Add tag..."
                  className="rounded-full border border-dashed border-divider px-3 py-1 text-xs text-subtle focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-primary">
                <ChevronLeft size={15} />
                Back to Step 1
              </button>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <button onClick={() => setStep(1)} className="rounded-full border border-divider px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary">
                  Cancel
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
                >
                  Continue to review
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8 flex flex-col gap-6">
            <div>
              <span className="rounded-full bg-lime/40 px-3 py-1 text-xs font-bold text-primary">Post preview</span>
              <div className="mt-4 rounded-2xl border border-divider p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-bold text-lime">A</div>
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

                <div className="mt-4 h-40 overflow-hidden rounded-xl bg-gradient-to-br from-primary/80 to-accent/60">
                  <div className="flex h-full items-center justify-center text-sm text-white/40">Post Image</div>
                </div>

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
                <button className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95">
                  <Check size={15} />
                  Publish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
