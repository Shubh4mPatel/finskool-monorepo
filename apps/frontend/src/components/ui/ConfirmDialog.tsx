"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // "danger" is the delete-confirmation look: vivid red, trash-style icon via `icon`, dark message
  // text, a teal-outlined Cancel and compact buttons. "destructive" is the original red style.
  variant?: "destructive" | "positive" | "danger";
  /** Replaces the default warning triangle inside the round icon badge. */
  icon?: ReactNode;
}

const BASE_CANCEL = "border-divider text-primary hover:bg-divider/60";
const VARIANT_STYLES = {
  destructive: {
    iconBg: "bg-[#dc2626]/10",
    accent: "text-[#dc2626]",
    button: "bg-[#dc2626]",
    message: "text-muted",
    cancel: BASE_CANCEL,
    buttonSize: "flex-1 px-5",
  },
  positive: {
    iconBg: "bg-[#4caf50]/10",
    accent: "text-[#4caf50]",
    button: "bg-[#4caf50]",
    message: "text-muted",
    cancel: BASE_CANCEL,
    buttonSize: "flex-1 px-5",
  },
  danger: {
    iconBg: "bg-[#f5002d]/10",
    accent: "text-[#f5002d]",
    button: "bg-[#f5002d]",
    message: "text-primary",
    cancel: "border-primary text-primary hover:bg-primary/5",
    buttonSize: "px-7",
  },
} as const;

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  function settle(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (() => {
        const styles = VARIANT_STYLES[state.options.variant ?? "destructive"];
        return (
          <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
            onClick={() => settle(false)}
          >
            <div
              className="animate-rise w-full max-w-100 rounded-2xl bg-white px-7 py-8 text-center shadow-card-hover"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`mx-auto flex h-13 w-13 items-center justify-center rounded-full ${styles.iconBg} ${styles.accent}`}>
                {state.options.icon ?? <AlertTriangle size={22} />}
              </div>
              <h3 className={`mt-4 font-display text-base font-bold ${styles.accent}`}>
                {state.options.title ?? "Confirm Action"}
              </h3>
              <p className={`mt-2 text-sm leading-relaxed ${styles.message}`}>{state.options.message}</p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={() => settle(false)}
                  className={`rounded-full border py-2.5 text-sm font-semibold transition-colors ${styles.buttonSize} ${styles.cancel}`}
                >
                  {state.options.cancelLabel ?? "Cancel"}
                </button>
                <button
                  onClick={() => settle(true)}
                  className={`rounded-full py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 ${styles.buttonSize} ${styles.button}`}
                >
                  {state.options.confirmLabel ?? "Yes"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
