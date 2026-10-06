"use client";

import { useRef, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

/**
 * A reorderable list of editable rows — the position in the list is the item's priority.
 * Reorder by dragging the handle, or focus it and use the arrow keys.
 */
export default function PriorityList<T extends { id: string }>({
  items,
  onChange,
  renderFields,
  makeItem,
  addLabel,
  max,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  /** The row's inputs. `update` patches just this item. */
  renderFields: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  makeItem: () => T;
  addLabel: string;
  max: number;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) rows.current.set(item.id, el);
            else rows.current.delete(item.id);
          }}
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={() => {
            if (dragId) move(items.findIndex((i) => i.id === dragId), index);
            setDragId(null);
          }}
          className={`flex items-start gap-2 transition-opacity ${dragId === item.id ? "opacity-40" : ""}`}
        >
          <button
            type="button"
            draggable
            aria-label="Drag to reorder (or use the up and down arrow keys)"
            title="Drag to reorder"
            onDragStart={(e) => {
              setDragId(item.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
              const row = rows.current.get(item.id);
              if (row) e.dataTransfer.setDragImage(row, 0, 0);
            }}
            onDragEnd={() => setDragId(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); move(index, index - 1); }
              if (e.key === "ArrowDown") { e.preventDefault(); move(index, index + 1); }
            }}
            className="mt-2 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-subtle hover:text-primary active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>

          <div className="min-w-0 flex-1">
            {renderFields(item, (patch) => onChange(items.map((i) => (i.id === item.id ? { ...i, ...patch } : i))))}
          </div>

          <button
            type="button"
            title="Edit"
            aria-label="Edit"
            onClick={() => rows.current.get(item.id)?.querySelector<HTMLElement>("input, textarea, select")?.focus()}
            className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent transition-colors hover:bg-accent/20"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            title="Delete"
            aria-label="Delete"
            onClick={() => onChange(items.filter((i) => i.id !== item.id))}
            className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-500 transition-colors hover:bg-red-100"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...items, makeItem()])}
        disabled={items.length >= max}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent/50 py-2.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={13} />
        {items.length >= max ? `Maximum of ${max} reached` : addLabel}
      </button>
    </div>
  );
}
