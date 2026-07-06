"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

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
      {state && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
          onClick={() => settle(false)}
        >
          <div
            className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-card-hover"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
              <AlertTriangle size={26} />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-red-500">
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
                className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
              >
                {state.options.confirmLabel ?? "Yes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
