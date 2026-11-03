"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { ApiError } from "@/lib/api";
import { performanceApi, type Board } from "@/lib/performance";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/admin/dashboard/Panel";

const numberInput =
  "w-14 rounded-lg border border-divider bg-white px-2 py-1.5 text-center text-sm font-bold tabular-nums text-primary transition-all focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10";

/**
 * The board-wide rules for free members: hide trades newer than N days, show at most M. Rows set to Auto follow
 * them. The inputs are always editable; a Save button appears once a value differs from what is stored.
 * The parent remounts this (via `key`) after a save, so the inputs always start from the stored values.
 */
export function VisibilityBar({ board, onSaved }: { board: Board; onSaved: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState(String(board.hideNewerThanDays));
  const [max, setMax] = useState(String(board.maxFreeTrades));
  const [saving, setSaving] = useState(false);

  const parsedDays = Number(days);
  const parsedMax = Number(max);
  const valid =
    days.trim() !== "" && max.trim() !== "" &&
    Number.isInteger(parsedDays) && parsedDays >= 0 && parsedDays <= 365 &&
    Number.isInteger(parsedMax) && parsedMax >= 0 && parsedMax <= 50;
  const dirty = parsedDays !== board.hideNewerThanDays || parsedMax !== board.maxFreeTrades;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await performanceApi.updateSettings(board.communityId, { hideNewerThanDays: parsedDays, maxFreeTrades: parsedMax });
      toast.success({ title: "Free member rules saved", message: `Hiding trades newer than ${parsedDays} days, showing at most ${parsedMax}.` });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the rules");
      setSaving(false);
    }
  }

  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Eye size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-primary">Free member visibility</p>
            <p className="text-xs text-muted">Rows set to Auto follow these rules. Use Show or Hide to override.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-xl bg-background px-3 py-2 text-xs font-semibold text-muted">
            Hide trades newer than
            <input
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              value={days}
              onChange={e => setDays(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void save()}
              aria-label="Hide trades newer than this many days"
              className={numberInput}
            />
            days
          </label>
          <label className="flex items-center gap-2 rounded-xl bg-background px-3 py-2 text-xs font-semibold text-muted">
            Show at most
            <input
              type="number"
              min={0}
              max={50}
              inputMode="numeric"
              value={max}
              onChange={e => setMax(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void save()}
              aria-label="Show at most this many trades"
              className={numberInput}
            />
            trades
          </label>
          {dirty && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!valid || saving}
              className="animate-enter rounded-full bg-primary px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
      {dirty && !valid && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-500">
          Days must be a whole number from 0 to 365, and trades from 0 to 50.
        </p>
      )}
    </Card>
  );
}
