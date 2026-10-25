"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import type { AdminPost } from "./types";
import { useEscape } from "./useEscape";

export default function PostMenu({ post, busy, onEdit, onDelete, onPin }: {
  post: AdminPost;
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
