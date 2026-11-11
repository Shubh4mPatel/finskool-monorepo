"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatMonth, performanceApi, recentMonths, type BoardRef, type PerformanceSegment, type Period } from "@/lib/performance";
import { usePanel } from "@/components/admin/dashboard/usePanel";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

/** Add or edit a hit-rate card: the months it runs from and to, both inclusive. */
export default function PeriodModal({
  board,
  segment,
  period,
  onClose,
  onDone,
}: {
  board: BoardRef;
  segment: PerformanceSegment;
  period?: Period | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const editing = period !== undefined;

  // Four years back, plus whatever an existing period already uses.
  const months = useMemo(() => {
    const all = new Set(recentMonths(48));
    if (period) {
      all.add(period.fromMonth);
      all.add(period.toMonth);
    }
    return [...all].sort().reverse();
  }, [period]);
  const monthOptions = useMemo(() => months.map(m => ({ value: m, label: formatMonth(m) })), [months]);

  const [name, setName] = useState(period?.name ?? "");
  const [nameError, setNameError] = useState<string | undefined>();
  const [isDefault, setIsDefault] = useState(period?.isDefault ?? false);
  const [from, setFrom] = useState(period?.fromMonth ?? months[Math.min(5, months.length - 1)]!);
  const [to, setTo] = useState(period?.toMonth ?? months[0]!);
  const [busy, setBusy] = useState(false);
  const reversed = from > to;

  // The cards already on this segment, so a repeat range is caught before the server is asked.
  const overview = usePanel(`period-modal:${board.communityId}:${segment}`, () => performanceApi.overview(board.communityId, segment));
  const summary = overview.data?.summary;
  const duplicate =
    !reversed &&
    summary !== undefined &&
    summary.kind !== "intraday" &&
    summary.kind !== "holding" &&
    summary.periods.some(p => p.id !== period?.id && p.fromMonth === from && p.toMonth === to);
  const invalid = reversed || duplicate;
  // The first card of a segment is always the default, and the default can only be handed over by choosing another card.
  const firstCard = !editing && summary !== undefined && summary.kind !== "intraday" && summary.kind !== "holding" && summary.periods.length === 0;
  const locked = firstCard || (editing && period.isDefault);
  const defaultOn = locked || isDefault;

  async function save() {
    if (invalid) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }
    setBusy(true);
    try {
      const body = { name: trimmed, fromMonth: from, toMonth: to, isDefault: defaultOn };
      if (period) await performanceApi.updatePeriod(board.communityId, period.id, body);
      else await performanceApi.addPeriod(board.communityId, segment, body);
      toast.success({ title: editing ? "Period updated" : "Period added", message: trimmed });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the period");
      setBusy(false);
    }
  }

  async function remove() {
    if (!period) return;
    const ok = await confirm({
      title: "Remove this period?",
      message: `The ${period.name} card disappears from the screen and the app. No trades are deleted.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await performanceApi.deletePeriod(board.communityId, period.id);
      toast.success({ title: "Period removed", message: period.name });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the period");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit period" : "Add period"}
      subtitle={board.communityName}
      icon={<CalendarRange size={18} />}
      size="sm"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {editing && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              aria-label="Remove period"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy || invalid} className={primaryBtn}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        The card counts the trades given between these two months, and how many of them have met their target.
      </p>
      <FormField label="Name" error={nameError}>
        <input
          value={name}
          onChange={e => {
            setName(e.target.value);
            setNameError(undefined);
          }}
          placeholder="e.g. Last 6 months"
          maxLength={60}
          disabled={busy}
          aria-label="Period name"
          className={inputCls(nameError)}
        />
      </FormField>
      <FormField label="From">
        <Select
          value={from}
          onChange={setFrom}
          options={monthOptions}
          ariaLabel="From month"
          portal
          disabled={busy}
          className="w-full"
          triggerClassName={`${inputCls()} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
        />
      </FormField>
      <FormField
        label="To"
        error={reversed ? "The period cannot end before it starts" : duplicate ? "This period already exists. Pick a different range." : undefined}
      >
        <Select
          value={to}
          onChange={setTo}
          options={monthOptions}
          ariaLabel="To month"
          portal
          disabled={busy}
          className="w-full"
          triggerClassName={`${inputCls(invalid ? "x" : undefined)} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
        />
      </FormField>
      <div className="flex items-start justify-between gap-4 rounded-xl bg-background px-4 py-3">
        <div className="min-w-0">
          <p id="period-default-label" className="text-sm font-bold text-primary">
            Default in app
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {firstCard
              ? "The first period is always the default."
              : editing && period.isDefault
                ? "This is the default. Turn on another period to change it."
                : "The app opens on this period first. Only one period is the default; this replaces the current one."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={defaultOn}
          aria-labelledby="period-default-label"
          disabled={busy || locked}
          onClick={() => setIsDefault(v => !v)}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60 ${defaultOn ? "bg-accent" : "bg-divider"}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${defaultOn ? "translate-x-5" : ""}`} />
        </button>
      </div>
    </Modal>
  );
}
