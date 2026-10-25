"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useEscape } from "@/components/admin/posts/useEscape";

/**
 * A dialog shell: dimmed backdrop, rising panel, fixed header and footer with a scrolling body.
 * Escape and a backdrop click close it — unless `busy` (a save is in flight).
 */
export default function Modal({
  title,
  subtitle,
  icon,
  iconClass = "bg-accent/10 text-accent",
  onClose,
  busy = false,
  size = "md",
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  iconClass?: string;
  onClose: () => void;
  busy?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
  footer: ReactNode;
}) {
  const titleId = useId();
  useEscape(!busy, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade absolute inset-0 bg-primary/35 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-enter relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-card-hover ${
          size === "sm" ? "max-w-sm" : "max-w-md"
        }`}
      >
        <div className="flex items-start gap-3 border-b border-divider px-6 py-4">
          {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>{icon}</span>}
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="font-display text-lg font-bold leading-tight text-primary">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex items-center gap-3 border-t border-divider px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}
