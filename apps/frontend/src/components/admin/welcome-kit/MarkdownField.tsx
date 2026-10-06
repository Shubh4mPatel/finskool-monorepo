"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Bold } from "lucide-react";

/**
 * Rich-text box (bold shows as you type) whose value is plain markdown — that is what gets stored
 * and what the mobile app renders. Limited to what markdown expresses well: bold, italic, lists, links.
 */
export default function MarkdownField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
      }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false, // Next renders this on the server first
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: { attributes: { class: "outline-none" } },
  });

  // Pick up a value changed from outside (not by typing here, which already matches).
  useEffect(() => {
    if (editor && value !== editor.getMarkdown()) editor.commands.setContent(value, { contentType: "markdown" });
  }, [editor, value]);

  const bold = editor?.isActive("bold") ?? false;

  return (
    <div className="rounded-lg border border-[#d4d4d4] bg-white px-3 pb-3 pt-3 transition-colors focus-within:border-accent">
      <button
        type="button"
        title="Bold"
        aria-label="Bold"
        aria-pressed={bold}
        onClick={() => editor?.chain().focus().toggleBold().run()}
        className={`flex h-[30px] w-[38px] items-center justify-center rounded-lg text-sm transition-colors ${
          bold ? "bg-primary/10 text-primary" : "bg-[#f1f1f1] text-[#9a9a9a] hover:text-primary"
        }`}
      >
        <Bold size={14} strokeWidth={2.5} />
      </button>
      <EditorContent
        editor={editor}
        className="mt-3 min-h-14 text-[15px] leading-relaxed text-[#1d2b27] [&_.ProseMirror]:min-h-14 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-0 [&_.ProseMirror_strong]:font-bold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_a]:text-accent [&_.ProseMirror_a]:underline [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
