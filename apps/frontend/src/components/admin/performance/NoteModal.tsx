"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { ApiError } from "@/lib/api";
import { performanceApi, formatRupees, type Board } from "@/lib/performance";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

const num = (s: string): number => Number(s.replace(/[,\s₹]/g, ""));

/** The intraday assumptions every calculation on the board uses, and the banner that states them. */
export default function NoteModal({ board, onClose, onDone }: { board: Board; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [capital, setCapital] = useState(String(board.capital));
  const [margin, setMargin] = useState(String(board.margin));
  const [charges, setCharges] = useState(String(board.chargesPerTrade));
  const [note, setNote] = useState(board.note ?? "");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  const defaultNote = `All calculations are done assuming INR ${formatRupees(num(capital) || board.capital)} capital deployed and ${num(margin) || board.margin}X margin used in each trade.`;

  async function save() {
    const e: Record<string, string> = {};
    if (!(num(capital) > 0)) e["capital"] = "Enter an amount above 0";
    if (!(num(margin) >= 1 && num(margin) <= 100)) e["margin"] = "Margin must be between 1 and 100";
    if (charges.trim() === "" || !(num(charges) >= 0)) e["charges"] = "Enter 0 or more";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setBusy(true);
    try {
      await performanceApi.updateSettings(board.communityId, {
        capital: num(capital),
        margin: num(margin),
        chargesPerTrade: num(charges),
        note: note.trim() || null,
      });
      toast.success({ title: "Assumptions saved", message: "Every trade on the board has been recalculated." });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k === "chargesPerTrade" ? "charges" : k, v[0]])));
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not save");
      }
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Calculation assumptions"
      subtitle={board.communityName}
      icon={<SlidersHorizontal size={18} />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Capital and margin decide how many shares each trade is sized at. Changing them recalculates every trade on the board, past ones included.
        Charges differ from trade to trade, so each trade can carry its own; the charges below apply only to trades that have none.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Capital (INR)" error={errors["capital"]}>
          <input value={capital} onChange={e => setCapital(e.target.value)} inputMode="decimal" disabled={busy} className={inputCls(errors["capital"])} />
        </FormField>
        <FormField label="Margin (x)" error={errors["margin"]}>
          <input value={margin} onChange={e => setMargin(e.target.value)} inputMode="decimal" disabled={busy} className={inputCls(errors["margin"])} />
        </FormField>
        <FormField label="Default charges per trade (INR)" error={errors["charges"]}>
          <input value={charges} onChange={e => setCharges(e.target.value)} inputMode="decimal" disabled={busy} className={inputCls(errors["charges"])} />
        </FormField>
      </div>
      <FormField label="Banner text" error={errors["note"]}>
        <textarea
          rows={3}
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder={defaultNote}
          className={`${inputCls(errors["note"])} resize-none`}
        />
        <p className="mt-1 text-xs text-subtle">Leave empty to use the sentence above, built from the capital and margin.</p>
      </FormField>
    </Modal>
  );
}
