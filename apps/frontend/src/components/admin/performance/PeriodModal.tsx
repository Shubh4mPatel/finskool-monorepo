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

  async function save() {
    if (invalid) return;
    setBusy(true);
    try {
      if (period) await performanceApi.updatePeriod(board.communityId, period.id, from, to);
      else await performanceApi.addPeriod(board.communityId, segment, from, to);
      toast.success({ title: editing ? "Period updated" : "Period added", message: `${formatMonth(from)} to ${formatMonth(to)}` });
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
      message: `The ${period.label} card disappears from the screen and the app. No trades are deleted.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await performanceApi.deletePeriod(board.communityId, period.id);
      toast.success({ title: "Period removed", message: period.label });
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
    </Modal>
  );
}
