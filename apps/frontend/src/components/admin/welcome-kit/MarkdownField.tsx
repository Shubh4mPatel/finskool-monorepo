"use client";

import { useRef, useState } from "react";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from "lucide-react";
import MarkdownView from "./MarkdownView";

type Action = { label: string; icon: typeof Bold; apply: (selected: string) => { text: string; select?: [number, number] } };

// Each action rewrites the selected text and (optionally) says what to select afterwards.
const ACTIONS: Action[] = [
  { label: "Bold", icon: Bold, apply: (s) => ({ text: `**${s || "bold text"}**` }) },
  { label: "Italic", icon: Italic, apply: (s) => ({ text: `_${s || "italic text"}_` }) },
  { label: "Bullet list", icon: List, apply: (s) => ({ text: (s || "item").split("\n").map((l) => `- ${l}`).join("\n") }) },
  { label: "Numbered list", icon: ListOrdered, apply: (s) => ({ text: (s || "item").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") }) },
  { label: "Link", icon: LinkIcon, apply: (s) => ({ text: `[${s || "link text"}](https://)` }) },
];

/** Markdown textarea with a small formatting toolbar and a Write / Preview switch. The value is raw markdown. */
export default function MarkdownField({
  value,
  onChange,
  placeholder,
  maxLength = 5000,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function run(action: Action) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const { text } = action.apply(value.slice(a, b));
    onChange(value.slice(0, a) + text + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a, a + text.length);
    });
  }

  const tab = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${active ? "bg-primary text-white" : "text-muted hover:text-primary"}`;

  return (
    <div className="rounded-xl border border-divider bg-white px-3 pb-2 pt-2.5 focus-within:border-accent">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-background px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              title={action.label}
              disabled={preview}
              onClick={() => run(action)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-divider/60 hover:text-primary disabled:opacity-40"
            >
              <action.icon size={14} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPreview(false)} className={tab(!preview)}>Write</button>
          <button type="button" onClick={() => setPreview(true)} className={tab(preview)}>Preview</button>
        </div>
      </div>
      {preview ? (
        <div className="min-h-24 px-1 pt-2">
          {value.trim() ? <MarkdownView markdown={value} /> : <p className="text-sm text-subtle">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={4}
          className="mt-2 min-h-24 w-full resize-y bg-transparent px-1 text-sm text-primary placeholder:text-subtle focus:outline-none"
        />
      )}
    </div>
  );
}
