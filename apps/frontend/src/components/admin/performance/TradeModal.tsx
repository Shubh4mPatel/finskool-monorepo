"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  performanceApi,
  type BoardRef,
  isHoldingSegment,
  type HoldingRow,
  type IntradayRow,
  type PerformanceSegment,
  type SwingRow,
  type TradeInput,
  type TradeRow,
  type TradeVisibility,
} from "@/lib/performance";
import { toDateParam } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";
import StockPicker from "./StockPicker";

type Errors = Partial<Record<string, string>>;

interface Form {
  tradeDate: string;
  name: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: string;
  exitPrice: string;
  charges: string;
  cmp: string;
  targetPct: string;
  analysis: string;
  theme: string;
  exitDate: string;
  visibility: TradeVisibility;
}

const ANALYSIS_SUGGESTIONS = ["HOLD", "Can Avg at CMP", "Can Add at CMP", "5% booked", "10% booked"];

function initialForm(trade: TradeRow | undefined): Form {
  const swing = trade as SwingRow | undefined;
  const intraday = trade as IntradayRow | undefined;
  return {
    tradeDate: trade?.tradeDate ?? toDateParam(new Date()),
    name: trade?.name ?? "",
    symbol: swing?.symbol ?? "",
    side: intraday?.side ?? "buy",
    entryPrice: trade ? String(trade.entryPrice) : "",
    exitPrice: intraday?.exitPrice !== undefined ? String(intraday.exitPrice) : "",
    // Only what is stored on the trade: empty means it follows the board's default charges.
    charges: intraday?.ownCharges != null ? String(intraday.ownCharges) : "",
    cmp: swing?.cmp != null ? String(swing.cmp) : "",
    targetPct: swing?.targetPct != null ? String(swing.targetPct) : "",
    analysis: swing?.analysis ?? "",
    theme: (trade as HoldingRow | undefined)?.theme ?? "",
    exitDate: swing?.exitDate ?? "",
    visibility: trade?.visibility ?? "auto",
  };
}

const num = (s: string): number => Number(s.replace(/[,\s₹]/g, ""));
const isPositive = (s: string): boolean => s.trim() !== "" && Number.isFinite(num(s)) && num(s) > 0;

/** Add a trade by hand, or edit / delete one that is already on the board. */
export default function TradeModal({
  board,
  segment,
  trade,
  onClose,
  onDone,
}: {
  board: BoardRef;
  segment: PerformanceSegment;
  /** Present when editing. */
  trade?: TradeRow | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const intraday = board.kind === "intraday";
  // Long Term / US Investment sheets have no target or exit date, so the form does not ask for them.
  const holding = isHoldingSegment(segment);
  const editing = trade !== undefined;
  const [form, setForm] = useState<Form>(() => initialForm(trade));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  // The stock chosen from the suggestions (or, when editing, the one the trade already shows), for the logo in the Stock field.
  const [picked, setPicked] = useState<{ name: string; logoUrl: string | null } | null>(() => (trade?.logoUrl ? { name: trade.name, logoUrl: trade.logoUrl } : null));

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!form.tradeDate) e["tradeDate"] = "Date is required";
    if (!form.name.trim()) e["name"] = intraday ? "Stock is required" : holding ? "Company name is required" : "Trade name is required";
    if (!intraday && !form.symbol.trim()) e["symbol"] = "NSE code is required";
    if (!isPositive(form.entryPrice)) e["entryPrice"] = "Enter a price above 0";
    if (intraday && !isPositive(form.exitPrice)) e["exitPrice"] = "Enter a price above 0";
    if (intraday && form.charges.trim() && !(Number.isFinite(num(form.charges)) && num(form.charges) >= 0)) e["charges"] = "Enter an amount of 0 or more";
    if (!intraday) {
      if (form.cmp.trim() && !isPositive(form.cmp)) e["cmp"] = "Enter a price above 0";
      if (!holding) {
        if (form.targetPct.trim() && (!isPositive(form.targetPct) || num(form.targetPct) > 999.99)) e["targetPct"] = "Enter a percentage above 0";
        if (form.exitDate && form.exitDate < form.tradeDate) e["exitDate"] = "Exit date cannot be before the trade date";
      }
    }
    return e;
  }

  function payload(): TradeInput {
    const base = {
      tradeDate: form.tradeDate,
      name: form.name.trim(),
      entryPrice: num(form.entryPrice),
      visibility: form.visibility,
    };
    // Charges differ from trade to trade; left empty (null) the trade uses the board's default.
    if (intraday) return { ...base, side: form.side, exitPrice: num(form.exitPrice), charges: form.charges.trim() ? num(form.charges) : null };
    if (holding) {
      return {
        ...base,
        symbol: form.symbol.trim(),
        cmp: form.cmp.trim() ? num(form.cmp) : null,
        analysis: form.analysis.trim() || null,
        theme: form.theme.trim() || null,
      };
    }
    return {
      ...base,
      symbol: form.symbol.trim(),
      cmp: form.cmp.trim() ? num(form.cmp) : null,
      targetPct: form.targetPct.trim() ? num(form.targetPct) : null,
      analysis: form.analysis.trim() || null,
      exitDate: form.exitDate || null,
    };
  }

  async function save() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      if (trade) await performanceApi.updateTrade(board.communityId, trade.id, payload());
      else await performanceApi.addTrade(board.communityId, segment, payload());
      toast.success({ title: editing ? "Trade updated" : "Trade added", message: form.name.trim() });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])));
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not save the trade");
      }
      setBusy(false);
    }
  }

  async function remove() {
    if (!trade) return;
    const ok = await confirm({
      title: "Delete this trade?",
      message: `${trade.name} will be removed from the board and from the app. Uploading a sheet that still has it adds it back.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await performanceApi.deleteTrade(board.communityId, trade.id);
      toast.success({ title: "Trade deleted", message: trade.name });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the trade");
      setBusy(false);
    }
  }

  const text = (key: keyof Form, placeholder: string, mode?: "decimal") => (
    <input
      value={form[key]}
      onChange={e => set(key, e.target.value as never)}
      placeholder={placeholder}
      inputMode={mode}
      disabled={busy}
      className={inputCls(errors[key])}
    />
  );

  return (
    <Modal
      title={editing ? "Edit trade" : "Add trade"}
      subtitle={board.communityName}
      icon={editing ? <Pencil size={18} /> : <Plus size={18} />}
      size="lg"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {editing && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              aria-label="Delete trade"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add trade"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Date" error={errors["tradeDate"]}>
          <DatePicker value={form.tradeDate} onChange={v => set("tradeDate", v)} triggerClassName={inputCls(errors["tradeDate"])} ariaLabel="Trade date" />
        </FormField>
        <FormField label={intraday ? "Stock" : holding ? "Company name" : "Trade name"} error={errors["name"]}>
          {intraday ? (
            <StockPicker
              value={form.name}
              onChange={v => set("name", v)}
              onPick={stock => {
                set("name", stock.name);
                setPicked({ name: stock.name, logoUrl: stock.logoUrl });
              }}
              selected={picked}
              error={errors["name"]}
              disabled={busy}
              placeholder="Search a stock, e.g. Ambuja"
              ariaLabel="Stock"
            />
          ) : (
            text("name", "BLS International")
          )}
        </FormField>

        {holding && (
          <FormField label="Theme / Sector / Type (optional)" error={errors["theme"]}>
            <input
              value={form.theme}
              onChange={e => set("theme", e.target.value)}
              placeholder="e.g. Ports Monopoly"
              maxLength={100}
              disabled={busy}
              className={inputCls(errors["theme"])}
            />
          </FormField>
        )}

        {!intraday && (
          <FormField label="NSE code" error={errors["symbol"]}>
            {text("symbol", "BLS")}
          </FormField>
        )}
        {intraday && (
          <FormField label="Type">
            <div role="group" aria-label="Type" className="flex w-fit rounded-full bg-background p-1">
              {(["buy", "sell"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={form.side === s}
                  onClick={() => set("side", s)}
                  className={`rounded-full px-5 py-1.5 text-xs font-bold transition-all ${form.side === s ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"}`}
                >
                  {s === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
          </FormField>
        )}

        <FormField label="Entry price" error={errors["entryPrice"]}>
          {text("entryPrice", "0.00", "decimal")}
        </FormField>
        {intraday ? (
          <FormField label="Exit price" error={errors["exitPrice"]}>
            {text("exitPrice", "0.00", "decimal")}
          </FormField>
        ) : (
          <FormField label="CMP (optional)" error={errors["cmp"]}>
            {text("cmp", "Current market price", "decimal")}
          </FormField>
        )}

        {!intraday && (
          <>
            {!holding && (
              <FormField label={`Target % (blank = ${board.kind === "investor" ? 10 : 5}%)`} error={errors["targetPct"]}>
                {text("targetPct", board.kind === "investor" ? "10" : "5", "decimal")}
              </FormField>
            )}
            <FormField label="Analysis (optional)" error={errors["analysis"]}>
              <input
                list="performance-analysis"
                value={form.analysis}
                onChange={e => set("analysis", e.target.value)}
                placeholder="HOLD"
                maxLength={60}
                disabled={busy}
                className={inputCls(errors["analysis"])}
              />
              <datalist id="performance-analysis">
                {ANALYSIS_SUGGESTIONS.map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </FormField>
            {!holding && (
              <FormField label="Exit date (leave empty while open)" error={errors["exitDate"]}>
                <DatePicker
                  value={form.exitDate}
                  onChange={v => set("exitDate", v)}
                  clearable
                  placeholder="Open"
                  triggerClassName={inputCls(errors["exitDate"])}
                  ariaLabel="Exit date"
                />
              </FormField>
            )}
          </>
        )}

        {intraday && (
          <FormField label="Charges (blank = board default)" error={errors["charges"]}>
            {text("charges", "Board default", "decimal")}
          </FormField>
        )}

        <FormField label="Free users">
          <Select
            value={form.visibility}
            onChange={v => set("visibility", v as TradeVisibility)}
            options={[
              { value: "auto", label: "Auto (follow the rules)" },
              { value: "show", label: "Show" },
              { value: "hide", label: "Hide" },
            ]}
            ariaLabel="Free users"
            portal
            searchable={false}
            disabled={busy}
            className="w-full"
            triggerClassName={`${inputCls()} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
          />
        </FormField>
      </div>
      {!intraday && (
        <p className="text-xs text-muted">A trade with an exit date has met its target. Clearing the exit date reopens it.</p>
      )}
    </Modal>
  );
}
