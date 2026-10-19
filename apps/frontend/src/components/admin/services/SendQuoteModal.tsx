"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { formatInr, previewQuote } from "@/lib/services";
import type { QuoteDefaults, ServiceQuote } from "@/lib/services";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

interface Props {
  requestId: string;
  memberName: string;
  defaults: QuoteDefaults | null;
  onClose: () => void;
  onSent: (quote: ServiceQuote) => void;
}

const field = "mt-1.5 h-11 w-full rounded-xl border border-[#dcd9d0] bg-white px-3.5 text-sm text-primary outline-none transition-colors focus:border-accent";

export default function SendQuoteModal({ requestId, memberName, defaults, onClose, onSent }: Props) {
  const confirm = useConfirm();
  const toast = useToast();
  const isSuperAdmin = getSession()?.isSuperAdmin ?? false;

  // The form is only mounted once the defaults are known, so these can start from them.
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(String(defaults?.defaultGstRatePercent ?? 18));
  const [days, setDays] = useState(String(defaults?.defaultQuoteExpiryDays ?? 5));
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const base = Number(amount);
  const preview = previewQuote(base, Number(rate));
  const notConfigured = defaults !== null && !defaults.configured;

  async function submit(confirmReplace = false) {
    setSending(true);
    setFieldErrors({});
    try {
      const body: Record<string, unknown> = {
        baseAmount: base,
        gstRatePercent: Number(rate),
        expiryDays: Number(days),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(confirmReplace ? { confirmReplace: true } : {}),
      };
      const res = await api.post<{ quote: ServiceQuote }>(`/api/v1/admin/services/${requestId}/quotes`, body);
      toast.success("Quote sent");
      onSent(res.quote);
    } catch (err) {
      if (err instanceof ApiError && err.code === "QUOTE_PAYMENT_IN_PROGRESS") {
        // The member opened the payment sheet moments ago: replacing now could strand their payment.
        const ok = await confirm({
          variant: "destructive",
          title: "Replace the current quote?",
          message: err.message,
          confirmLabel: "Replace anyway",
        });
        if (ok) await submit(true);
        return;
      }
      if (err instanceof ApiError && err.errors) {
        setFieldErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0] ?? "Invalid"])));
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Couldn't send the quote. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const valid = preview !== null && Number(days) >= 1 && Number.isInteger(Number(days));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4" role="dialog" aria-modal="true" aria-label="Send quote">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Send a quote</h2>
            <p className="mt-1 text-xs text-muted">{memberName} can pay it from the app. GST is added on top of your amount.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-divider hover:text-primary">
            <X size={16} />
          </button>
        </div>

        {notConfigured ? (
          <div className="mt-5 rounded-2xl bg-[#fff6dc] px-4 py-3 text-sm text-[#7a5200]">
            The seller billing details haven&apos;t been set up yet, so quotes (and invoices) can&apos;t be issued.{" "}
            {isSuperAdmin ? (
              <Link href="/admin/settings/billing" className="font-bold underline">Set them up now</Link>
            ) : (
              "Ask a super admin to fill in Billing settings."
            )}
          </div>
        ) : (
          <form
            className="mt-5 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid && !sending) submit();
            }}
          >
            <label className="text-xs font-semibold text-muted">
              Amount before GST (₹)
              <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" className={field} />
              {fieldErrors.baseAmount && <span className="mt-1 block text-[11px] text-red-500">{fieldErrors.baseAmount}</span>}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-muted">
                GST rate (%)
                <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={field} />
                {fieldErrors.gstRatePercent && <span className="mt-1 block text-[11px] text-red-500">{fieldErrors.gstRatePercent}</span>}
              </label>
              <label className="text-xs font-semibold text-muted">
                Valid for (days)
                <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={field} />
                {fieldErrors.expiryDays && <span className="mt-1 block text-[11px] text-red-500">{fieldErrors.expiryDays}</span>}
              </label>
            </div>

            <label className="text-xs font-semibold text-muted">
              Note to the member (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="What this covers, how long, anything they should know…"
                className="mt-1.5 w-full resize-none rounded-xl border border-[#dcd9d0] bg-white px-3.5 py-3 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
              />
            </label>

            <div className="rounded-2xl bg-background px-4 py-3 text-sm">
              <div className="flex justify-between text-muted"><span>Amount</span><span className="font-semibold text-primary">{preview ? formatInr(base) : "—"}</span></div>
              <div className="mt-1 flex justify-between text-muted"><span>GST @ {Number(rate) || 0}%</span><span className="font-semibold text-primary">{preview ? formatInr(preview.gst) : "—"}</span></div>
              <div className="mt-2 flex justify-between border-t border-divider pt-2 font-bold text-primary"><span>Member pays</span><span>{preview ? formatInr(preview.total) : "—"}</span></div>
            </div>

            <button
              type="submit"
              disabled={!valid || sending}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-linear-to-r from-lime to-accent text-sm font-bold text-primary shadow-glow transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              Send quote
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
