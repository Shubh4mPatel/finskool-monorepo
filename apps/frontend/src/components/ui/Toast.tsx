"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  title?: string;
}

interface ToastInput {
  message: string;
  title?: string;
}

interface ToastContextValue {
  show: (variant: ToastVariant, input: string | ToastInput) => void;
  success: (input: string | ToastInput) => void;
  error: (input: string | ToastInput) => void;
  info: (input: string | ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION = 4000;
// Keep in sync with the `.animate-toast-out` duration in globals.css.
const EXIT_DURATION = 500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Play the exit animation first, then unmount once it has finished.
  const dismiss = useCallback(
    (id: number) => {
      setLeaving((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      setTimeout(() => remove(id), EXIT_DURATION);
    },
    [remove],
  );

  const show = useCallback(
    (variant: ToastVariant, input: string | ToastInput) => {
      const { message, title } =
        typeof input === "string" ? { message: input, title: undefined } : input;
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, variant, message, title }]);
      setTimeout(() => dismiss(id), DURATION);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (input) => show("success", input),
      error: (input) => show("error", input),
      info: (input) => show("info", input),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} leaving={leaving} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const variantStyles: Record<
  ToastVariant,
  { Icon: LucideIcon; iconWrap: string; bar: string }
> = {
  success: { Icon: CheckCircle2, iconWrap: "bg-accent/10 text-accent", bar: "bg-accent" },
  error: { Icon: AlertCircle, iconWrap: "bg-red-50 text-red-600", bar: "bg-red-500" },
  info: { Icon: Info, iconWrap: "bg-primary/10 text-primary", bar: "bg-primary" },
};

function Toaster({
  toasts,
  leaving,
  onDismiss,
}: {
  toasts: Toast[];
  leaving: ReadonlySet<number>;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-100 flex flex-col items-center gap-3 px-4 sm:inset-x-auto sm:right-6 sm:items-end">
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          isLeaving={leaving.has(toast.id)}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  isLeaving,
  onDismiss,
}: {
  toast: Toast;
  isLeaving: boolean;
  onDismiss: (id: number) => void;
}) {
  const { Icon, iconWrap, bar } = variantStyles[toast.variant];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-2xl border border-divider bg-white/95 px-4 py-3.5 shadow-card-hover backdrop-blur-sm ${
        isLeaving ? "animate-toast-out" : "animate-rise"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconWrap}`}
      >
        <Icon size={18} />
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        {toast.title && (
          <p className="font-display text-sm font-bold leading-tight text-primary">
            {toast.title}
          </p>
        )}
        <p
          className={`text-sm leading-snug ${
            toast.title ? "mt-0.5 text-muted" : "text-primary"
          }`}
        >
          {toast.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1.5 text-subtle transition-colors hover:bg-divider hover:text-primary"
      >
        <X size={15} />
      </button>

      <span
        className={`animate-toast-progress absolute inset-x-0 bottom-0 h-[3px] origin-left ${bar}`}
        style={{ "--toast-duration": `${DURATION}ms` } as React.CSSProperties}
      />
    </div>
  );
}
