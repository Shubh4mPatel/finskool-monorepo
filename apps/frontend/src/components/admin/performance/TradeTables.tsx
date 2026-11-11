"use client";

import type { ReactNode } from "react";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { TH } from "@/components/admin/dashboard/Panel";
import {
  formatNumber,
  formatPct,
  formatPnl,
  formatRupees,
  formatTradeDate,
  gainClass,
  type HoldingRow,
  type IntradayRow,
  type SwingRow,
  type TradeVisibility,
} from "@/lib/performance";
import { FreeUsersSelect } from "./FreeUsersSelect";
import { StockAvatar } from "./StockAvatar";

interface TableProps<R> {
  rows: R[];
  /** The row whose Free users change is being saved. */
  busyId: string | null;
  onVisibility: (row: R, visibility: TradeVisibility) => void;
  onEdit: (row: R) => void;
}

const TD = "px-3 py-3 text-xs text-primary tabular-nums whitespace-nowrap";

/** What free members can see of this trade right now, after the rule bar: a green eye or a struck-through one. */
function VisibleIcon({ visible, visibility }: { visible: boolean; visibility: TradeVisibility }) {
  const label = visible
    ? "Free members can see this trade"
    : visibility === "hide"
      ? "Hidden from free members"
      : "Not shown to free members right now";
  return (
    <span title={label} className={`inline-flex shrink-0 ${visible ? "text-emerald-600" : visibility === "hide" ? "text-red-500" : "text-subtle"}`}>
      {visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-divider text-accent transition-colors hover:bg-accent/10"
    >
      <Pencil size={13} />
    </button>
  );
}

function Shell({ headers, children }: { headers: { label: string; right?: boolean }[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-background">
            {headers.map((h, i) => (
              <th
                key={h.label}
                scope="col"
                className={`${TH} whitespace-nowrap ${h.right ? "text-right" : ""} ${i === 0 ? "rounded-l-xl" : ""} ${i === headers.length - 1 ? "rounded-r-xl" : ""}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-divider/60">{children}</tbody>
      </table>
    </div>
  );
}

const pill = (tone: string, text: string) => (
  <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${tone}`}>{text}</span>
);

export function IntradayTable({ rows, busyId, onVisibility, onEdit }: TableProps<IntradayRow>) {
  return (
    <Shell
      headers={[
        { label: "S.N." },
        { label: "Date" },
        { label: "Stock" },
        { label: "Type" },
        { label: "Entry", right: true },
        { label: "Exit", right: true },
        { label: "P/L", right: true },
        { label: "P/L %", right: true },
        { label: "P&L", right: true },
        { label: "Charges", right: true },
        { label: "Net P&L", right: true },
        { label: "Free users" },
        { label: "Edit" },
      ]}
    >
      {rows.map(r => (
        <tr key={r.id} className="transition-colors hover:bg-background/60">
          <td className={`${TD} text-muted`}>{r.serialNo}</td>
          <td className={TD}>{formatTradeDate(r.tradeDate)}</td>
          <td className={`${TD} font-bold`}>
            <span className="flex items-center gap-2">
              <StockAvatar name={r.name} logoUrl={r.logoUrl} />
              {r.name}
              <VisibleIcon visible={r.visibleToFree} visibility={r.visibility} />
            </span>
          </td>
          <td className={TD}>
            {r.side === "buy" ? pill("bg-emerald-50 text-emerald-700", "Buy") : pill("bg-amber-50 text-amber-700", "Sell")}
          </td>
          <td className={`${TD} text-right`}>{formatNumber(r.entryPrice)}</td>
          <td className={`${TD} text-right`}>{formatNumber(r.exitPrice)}</td>
          <td className={`${TD} text-right font-semibold ${gainClass(r.plPerShare)}`}>{formatNumber(r.plPerShare)}</td>
          <td className={`${TD} text-right font-semibold ${gainClass(r.plPct)}`}>{formatPct(r.plPct)}</td>
          <td className={`${TD} text-right font-semibold ${gainClass(r.grossPnl)}`}>{formatPnl(r.grossPnl)}</td>
          <td className={`${TD} text-right text-muted`}>-{formatRupees(r.charges)}</td>
          <td className={`${TD} text-right`}>
            {pill(r.netPnl >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600", formatPnl(r.netPnl))}
          </td>
          <td className={TD}>
            <FreeUsersSelect
              value={r.visibility}
              disabled={busyId === r.id}
              ariaLabel={`Free users: ${r.name}`}
              onChange={v => onVisibility(r, v)}
            />
          </td>
          <td className={TD}>
            <EditButton label={`Edit ${r.name}`} onClick={() => onEdit(r)} />
          </td>
        </tr>
      ))}
    </Shell>
  );
}

/** "5% booked" is good news, "Can Avg at CMP" is an action, anything else (HOLD) is neutral. */
function analysisPill(text: string | null): ReactNode {
  if (!text) return <span className="text-subtle">-</span>;
  if (/booked/i.test(text)) return pill("bg-emerald-50 text-emerald-700", text);
  if (/^can\s/i.test(text)) return pill("bg-amber-50 text-amber-700", text);
  return pill("bg-accent/10 text-accent", text);
}

/** Long Term / US Investment: the sheet has no target, exit date or holding days, so neither does the table. */
export function HoldingTable({ rows, busyId, onVisibility, onEdit }: TableProps<HoldingRow>) {
  return (
    <Shell
      headers={[
        { label: "S.N." },
        { label: "Date" },
        { label: "Company Name" },
        { label: "NSE Code" },
        { label: "Entry", right: true },
        { label: "CMP", right: true },
        { label: "Returns", right: true },
        { label: "Analysis" },
        { label: "Free users" },
        { label: "Edit" },
      ]}
    >
      {rows.map(r => (
        <tr key={r.id} className="transition-colors hover:bg-background/60">
          <td className={`${TD} text-muted`}>{r.serialNo}</td>
          <td className={TD}>{formatTradeDate(r.tradeDate)}</td>
          <td className={`${TD} font-bold`}>
            <span className="flex items-center gap-2">
              <StockAvatar name={r.name} logoUrl={r.logoUrl} />
              {r.name}
              <VisibleIcon visible={r.visibleToFree} visibility={r.visibility} />
            </span>
          </td>
          <td className={`${TD} text-muted`}>{r.symbol}</td>
          <td className={`${TD} text-right`}>{formatNumber(r.entryPrice)}</td>
          <td className={`${TD} text-right`}>{r.cmp === null ? <span className="text-subtle">-</span> : formatNumber(r.cmp)}</td>
          <td className={`${TD} text-right font-semibold`}>
            {r.returnPct === null ? <span className="text-subtle">-</span> : <span className={gainClass(r.returnPct)}>{formatPct(r.returnPct, true)}</span>}
          </td>
          <td className={TD}>{analysisPill(r.analysis)}</td>
          <td className={TD}>
            <FreeUsersSelect
              value={r.visibility}
              disabled={busyId === r.id}
              ariaLabel={`Free users: ${r.name}`}
              onChange={v => onVisibility(r, v)}
            />
          </td>
          <td className={TD}>
            <EditButton label={`Edit ${r.name}`} onClick={() => onEdit(r)} />
          </td>
        </tr>
      ))}
    </Shell>
  );
}

export function SwingTable({ rows, busyId, onVisibility, onEdit }: TableProps<SwingRow>) {
  return (
    <Shell
      headers={[
        { label: "S.N." },
        { label: "Date" },
        { label: "Trade Name" },
        { label: "NSE Code" },
        { label: "Entry", right: true },
        { label: "CMP", right: true },
        { label: "Returns", right: true },
        { label: "Target", right: true },
        { label: "Target Price", right: true },
        { label: "Analysis" },
        { label: "Exit Date" },
        { label: "Holding Days", right: true },
        { label: "Free users" },
        { label: "Edit" },
      ]}
    >
      {rows.map(r => (
        <tr key={r.id} className="transition-colors hover:bg-background/60">
          <td className={`${TD} text-muted`}>{r.serialNo}</td>
          <td className={TD}>{formatTradeDate(r.tradeDate)}</td>
          <td className={`${TD} font-bold`}>
            <span className="flex items-center gap-2">
              <StockAvatar name={r.name} logoUrl={r.logoUrl} />
              {r.name}
              <VisibleIcon visible={r.visibleToFree} visibility={r.visibility} />
            </span>
          </td>
          <td className={`${TD} text-muted`}>{r.symbol}</td>
          <td className={`${TD} text-right`}>{formatNumber(r.entryPrice, 0)}</td>
          <td className={`${TD} text-right`}>{r.cmp === null ? <span className="text-subtle">-</span> : formatNumber(r.cmp)}</td>
          <td className={`${TD} text-right font-semibold`}>
            {r.status === "target_met" ? (
              <span className="inline-block rounded-full bg-emerald-700 px-2.5 py-0.5 text-[11px] font-bold text-white">Target Met</span>
            ) : r.returnPct === null ? (
              <span className="text-subtle">-</span>
            ) : (
              <span className={gainClass(r.returnPct)}>{formatPct(r.returnPct, true)}</span>
            )}
          </td>
          <td className={`${TD} text-right`}>{r.targetPct}%</td>
          <td className={`${TD} text-right`}>{formatNumber(r.targetPrice)}</td>
          <td className={TD}>{analysisPill(r.analysis)}</td>
          <td className={`${TD} font-semibold`}>
            {r.exitDate ? formatTradeDate(r.exitDate) : <span className="text-accent">Open</span>}
          </td>
          <td className={`${TD} text-right text-muted`}>{r.holdingDays ?? "-"}</td>
          <td className={TD}>
            <FreeUsersSelect
              value={r.visibility}
              disabled={busyId === r.id}
              ariaLabel={`Free users: ${r.name}`}
              onChange={v => onVisibility(r, v)}
            />
          </td>
          <td className={TD}>
            <EditButton label={`Edit ${r.name}`} onClick={() => onEdit(r)} />
          </td>
        </tr>
      ))}
    </Shell>
  );
}
