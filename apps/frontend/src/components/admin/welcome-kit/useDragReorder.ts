import { useRef, useState } from "react";

/**
 * Drag-to-reorder for a list. Spread `rowProps` on each row and `handleProps` on its grip button;
 * the grip also reorders with the arrow keys (so it works without a mouse).
 */
export function useDragReorder<T>(items: T[], getKey: (item: T) => string, onChange: (items: T[]) => void) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

  return {
    dragKey,
    rowElement: (key: string) => rows.current.get(key),
    rowProps: (key: string, index: number) => ({
      ref: (el: HTMLElement | null) => {
        if (el) rows.current.set(key, el);
        else rows.current.delete(key);
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragKey) e.preventDefault();
      },
      onDrop: () => {
        if (dragKey) move(items.findIndex((i) => getKey(i) === dragKey), index);
        setDragKey(null);
      },
    }),
    handleProps: (key: string, index: number) => ({
      draggable: true,
      title: "Drag to reorder",
      "aria-label": "Drag to reorder (or use the up and down arrow keys)",
      onDragStart: (e: React.DragEvent) => {
        setDragKey(key);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", key);
        const row = rows.current.get(key);
        if (row) e.dataTransfer.setDragImage(row, 0, 0);
      },
      onDragEnd: () => setDragKey(null),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          move(index, index - 1);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(index, index + 1);
        }
      },
    }),
  };
}
