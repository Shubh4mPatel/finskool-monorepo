"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Receipt } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { formatInr, previewQuote } from "@/lib/services";
import type { QuoteDefaults, ServiceQuote } from "@/lib/services";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

interface Props {
  requestId: string;
  memberName: string;
  defaults: QuoteDefaults | null;
  onClose: () => void;
  onSent: (quote: ServiceQuote) => void;
}

export default function SendQuoteModal({ requestId, memberName, defaults, onClose, onSent }: Props) {
  const confirm = useConfirm();
  const toast = useToast();
  const formId = useId();
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
    <Modal
      title="Send a quote"
      subtitle={`${memberName} can pay it from the app. GST is added on top of your amount.`}
      icon={<Receipt size={18} />}
      onClose={onClose}
      busy={sending}
      footer={
        notConfigured ? (
          <button type="button" onClick={onClose} className={secondaryBtn}>Close</button>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={sending} className={secondaryBtn}>Cancel</button>
            <button type="submit" form={formId} disabled={!valid || sending} className={primaryBtn}>
              {sending ? (
                <span className="inline-flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Sending…</span>
              ) : (
                "Send quote"
              )}
            </button>
          </>
        )
      }
    >
      {notConfigured ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            The seller billing details haven&apos;t been set up yet, so quotes (and invoices) can&apos;t be issued.{" "}
            {isSuperAdmin ? (
              <Link href="/admin/settings/billing" className="font-bold underline">Set them up now</Link>
            ) : (
              "Ask a super admin to fill in Billing settings."
            )}
          </span>
        </div>
      ) : (
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !sending) submit();
          }}
        >
          <FormField label="Amount before GST (₹)" error={fieldErrors["baseAmount"]}>
            <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" className={`${inputCls(fieldErrors["baseAmount"])} tabular-nums`} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="GST rate (%)" error={fieldErrors["gstRatePercent"]}>
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={`${inputCls(fieldErrors["gstRatePercent"])} tabular-nums`} />
            </FormField>
            <FormField label="Valid for (days)" error={fieldErrors["expiryDays"]}>
              <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={`${inputCls(fieldErrors["expiryDays"])} tabular-nums`} />
            </FormField>
          </div>

          <FormField label="Note to the member (optional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What this covers, how long, anything they should know…"
              className={`${inputCls()} resize-none`}
            />
          </FormField>

          {/* What the member will see and pay — updates as you type. */}
          <div className="rounded-2xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3.5 text-sm" aria-live="polite">
            <div className="flex justify-between text-muted"><span>Amount</span><span className="font-semibold tabular-nums text-primary">{preview ? formatInr(base) : "—"}</span></div>
            <div className="mt-1 flex justify-between text-muted"><span>GST @ {Number(rate) || 0}%</span><span className="font-semibold tabular-nums text-primary">{preview ? formatInr(preview.gst) : "—"}</span></div>
            <div className="mt-2.5 flex items-baseline justify-between border-t border-dashed border-accent/30 pt-2.5 text-primary">
              <span className="font-bold">Member pays</span>
              <span className="font-display text-xl font-bold tabular-nums">{preview ? formatInr(preview.total) : "—"}</span>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
