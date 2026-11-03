"use client";

import { Pencil } from "lucide-react";
import { Card } from "@/components/admin/dashboard/Panel";
import { formatPct, type Period } from "@/lib/performance";

/** The hit-rate cards: trades given, trades met and the share met, for a range of months. */
export function PeriodCards({ periods, onEdit }: { periods: Period[]; onEdit: (period: Period) => void }) {
  return (
    <>
      {periods.map((p, i) => (
        <Card key={p.id} delay={(i + 1) * 40} className="!p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-bold text-accent">{p.label}</span>
            <button
              type="button"
              onClick={() => onEdit(p)}
              aria-label={`Edit period ${p.label}`}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-divider text-accent transition-colors hover:bg-accent/10"
            >
              <Pencil size={12} />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <Figure label="Trades Given" value={String(p.given)} />
            <Figure label="Trades Met" value={String(p.met)} />
            <Figure label="Met %" value={formatPct(p.metPct)} tone="text-emerald-600" />
          </dl>
        </Card>
      ))}
    </>
  );
}

function Figure({ label, value, tone = "text-primary" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`mt-0.5 font-display text-xl font-bold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
