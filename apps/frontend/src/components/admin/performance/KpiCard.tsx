import { Card } from "@/components/admin/dashboard/Panel";

const TONE = { neutral: "text-primary", gain: "text-emerald-600", loss: "text-red-500" } as const;

/** A stat card: a quiet label over a large figure. `tone` colours the figure for gains and losses. */
export function KpiCard({
  label,
  value,
  tone = "neutral",
  caption,
  delay = 0,
  action,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE;
  caption?: string;
  delay?: number;
  action?: React.ReactNode;
}) {
  return (
    <Card delay={delay} className="!p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {action}
      </div>
      <p className={`mt-2 font-display text-2xl font-bold leading-none tracking-tight tabular-nums ${TONE[tone]}`}>{value}</p>
      {caption && <p className="mt-2 text-[11px] text-subtle">{caption}</p>}
    </Card>
  );
}
