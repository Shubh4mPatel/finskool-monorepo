"use client";

import type { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import TiptapLink from "@tiptap/extension-link";
import { Bold, Code, Italic, Link, List, ListOrdered } from "lucide-react";

/** Extensions shared by the Create Post and Edit Post editors, so both accept and save the same formatting. */
export const postEditorExtensions = [
  StarterKit,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TiptapLink.configure({ openOnClick: false }),
];

/** Styles for the formatted content inside the editor (lists and links need them back after the CSS reset). */
export const postEditorContentCls =
  "[&_.ProseMirror]:outline-none [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_li]:my-0.5 [&_.ProseMirror_a]:text-accent [&_.ProseMirror_a]:underline";

/** Bold, Italic, Bullet list, Numbered list, Link and Code: the one toolbar for writing and editing a post. */
export function TipTapToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
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
    { icon: Bold,        action: () => editor.chain().focus().toggleBold().run(),        active: editor.isActive("bold"),        label: "Bold" },
    { icon: Italic,      action: () => editor.chain().focus().toggleItalic().run(),      active: editor.isActive("italic"),      label: "Italic" },
    { icon: List,        action: () => editor.chain().focus().toggleBulletList().run(),  active: editor.isActive("bulletList"),  label: "Bullet List" },
    { icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList"), label: "Numbered List" },
    { icon: Link,        action: setLink,                                                active: editor.isActive("link"),        label: "Link" },
    { icon: Code,        action: () => editor.chain().focus().toggleCode().run(),        active: editor.isActive("code"),        label: "Code" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-background px-2 py-1.5">
      {tools.map(({ icon: Icon, action, active, label }) => (
        <button
          key={label}
          type="button"
          onClick={action}
          title={label}
          aria-label={label}
          aria-pressed={active}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted hover:bg-divider/60 hover:text-primary"}`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
