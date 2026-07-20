"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "positive";
}

const VARIANT_STYLES = {
  destructive: { iconBg: "bg-[#dc2626]/10", accent: "text-[#dc2626]", button: "bg-[#dc2626]" },
  positive: { iconBg: "bg-[#4caf50]/10", accent: "text-[#4caf50]", button: "bg-[#4caf50]" },
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
                <AlertTriangle size={22} />
              </div>
              <h3 className={`mt-4 font-display text-base font-bold ${styles.accent}`}>
                {state.options.title ?? "Confirm Action"}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{state.options.message}</p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={() => settle(false)}
                  className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-divider/60"
                >
                  {state.options.cancelLabel ?? "Cancel"}
                </button>
                <button
                  onClick={() => settle(true)}
                  className={`flex-1 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 ${styles.button}`}
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
