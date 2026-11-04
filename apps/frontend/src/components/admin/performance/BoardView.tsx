"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChartLine, Pencil, StickyNote } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  formatMonth,
  formatPct,
  formatRupees,
  performanceApi,
  type BoardListItem,
  type IntradayRow,
  type IntradaySummary,
  type PerformanceSegment,
  type Period,
  type SwingRow,
  type SwingSummary,
  type TradeRow,
  type TradeVisibility,
} from "@/lib/performance";
import { usePanel } from "@/components/admin/dashboard/usePanel";
import { Card, EmptyState, PanelError, SectionHeader, Skeleton } from "@/components/admin/dashboard/Panel";
import Pagination from "@/components/ui/Pagination";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { KpiCard } from "./KpiCard";
import { PeriodCards } from "./PeriodCards";
import { VisibilityBar } from "./VisibilityBar";
import { IntradayTable, SwingTable } from "./TradeTables";
import TradeModal from "./TradeModal";
import NoteModal from "./NoteModal";
import PeriodModal from "./PeriodModal";

const ALL = "all";

/**
 * One board's body: the stat cards, the free-member rule bar and the trades table. The page remounts it (via
 * `key`) when the community or segment changes, so the month and page always start fresh. `reload` goes up by
 * one whenever something changed elsewhere (an upload, an added trade) and refetches everything.
 */
export default function BoardView({
  board,
  segment,
  reload,
  onChanged,
}: {
  board: BoardListItem;
  segment: PerformanceSegment;
  reload: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [month, setMonth] = useState(ALL);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TradeRow | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  const id = board.communityId;
  const overview = usePanel(`overview:${id}:${segment}:${reload}`, () => performanceApi.overview(id, segment));
  const trades = usePanel(`trades:${id}:${segment}:${month}:${page}:${reload}`, () =>
    performanceApi.trades(id, { segment, ...(month === ALL ? {} : { month }), page, order: month === ALL ? "desc" : "asc" }),
  );

  // Deleting the last trade of the last page leaves the page number past the end: step back to the new last page.
  const empty = trades.data && trades.data.items.length === 0 && trades.data.total > 0 && page > 1;
  const lastPage = trades.data?.totalPages ?? 1;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (empty) setPage(lastPage);
  }, [empty, lastPage]);

  const ref = { communityId: id, communityName: board.name, kind: board.kind };
  const summary = overview.data?.summary;
  const intraday = board.kind === "intraday";

  async function changeVisibility(row: TradeRow, visibility: TradeVisibility) {
    setBusyId(row.id);
    try {
      await performanceApi.updateTrade(id, row.id, { visibility });
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change what free users see");
    } finally {
      setBusyId(null);
    }
  }

  const monthOptions = [{ value: ALL, label: "All months" }, ...(trades.data?.months ?? []).map(m => ({ value: m, label: formatMonth(m) }))];
  const total = trades.data?.total ?? 0;
  const boardTotal = summary?.totalTrades;

  return (
    <div className="flex flex-col gap-4">
      {overview.error ? (
        <Card>
          <PanelError message={overview.error} onRetry={overview.retry} />
        </Card>
      ) : !overview.data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {intraday && summary?.kind === "intraday" && (
            <IntradayStats summary={summary} noteText={overview.data.noteText} onEditNote={() => setNoteOpen(true)} />
          )}
          {!intraday && summary && summary.kind !== "intraday" && <SwingStats summary={summary} onEditPeriod={setEditingPeriod} />}

          <VisibilityBar
            key={`${overview.data.board.hideNewerThanDays}:${overview.data.board.maxFreeTrades}`}
            board={overview.data.board}
            onSaved={onChanged}
          />
        </>
      )}

      <Card className="!p-5">
        <SectionHeader
          title={`${board.name} Dashboard`}
          subtitle={
            trades.data
              ? month === ALL
                ? `${total} trade${total === 1 ? "" : "s"} · all months`
                : `${total} trade${total === 1 ? "" : "s"} in ${formatMonth(month)}${boardTotal !== undefined ? ` · ${boardTotal} on the board` : ""}`
              : "Loading trades…"
          }
          action={
            <Select
              value={month}
              onChange={m => {
                setMonth(m);
                setPage(1);
              }}
              options={monthOptions}
              ariaLabel="Month"
              align="right"
              searchable={false}
              leading={<CalendarDays size={14} className="text-muted" aria-hidden />}
              triggerClassName="relative flex items-center gap-2 rounded-xl border border-divider bg-white py-1.5 pl-3 text-xs font-semibold text-primary transition-colors hover:border-subtle focus:outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15"
            />
          }
        />

        {trades.error ? (
          <PanelError message={trades.error} onRetry={trades.retry} />
        ) : !trades.data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : trades.data.items.length === 0 ? (
          <EmptyState icon={<ChartLine size={18} />}>
            {month === ALL ? "No trades yet. Upload a sheet or add a trade to get started." : `No trades in ${formatMonth(month)}.`}
          </EmptyState>
        ) : (
          <div className={trades.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {intraday ? (
              <IntradayTable rows={trades.data.items as IntradayRow[]} busyId={busyId} onVisibility={changeVisibility} onEdit={setEditing} />
            ) : (
              <SwingTable rows={trades.data.items as SwingRow[]} busyId={busyId} onVisibility={changeVisibility} onEdit={setEditing} />
            )}

            <Pagination
              className="mt-4"
              page={trades.data.page}
              pageSize={trades.data.pageSize}
              total={trades.data.total}
              noun={trades.data.total === 1 ? "trade" : "trades"}
              onPage={setPage}
            />
          </div>
        )}
      </Card>

      {editing && <TradeModal board={ref} segment={segment} trade={editing} onClose={() => setEditing(null)} onDone={onChanged} />}
      {editingPeriod && <PeriodModal board={ref} segment={segment} period={editingPeriod} onClose={() => setEditingPeriod(null)} onDone={onChanged} />}
      {noteOpen && overview.data && <NoteModal board={overview.data.board} onClose={() => setNoteOpen(false)} onDone={onChanged} />}
    </div>
  );
}

const gain = (n: number) => (n > 0 ? "gain" : n < 0 ? "loss" : "neutral") as "gain" | "loss" | "neutral";

function IntradayStats({ summary, noteText, onEditNote }: { summary: IntradaySummary; noteText: string | null; onEditNote: () => void }) {
  return (
    <>
      <div className="animate-enter flex flex-wrap items-center gap-3 rounded-2xl bg-accent/10 px-4 py-3">
        <StickyNote size={16} className="shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 basis-72 text-xs text-primary">
          <span className="font-bold">Note: </span>
          {noteText}
        </p>
        <button
          type="button"
          onClick={onEditNote}
          className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-white px-3 py-1 text-xs font-bold text-accent transition-colors hover:bg-accent/5"
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Capital Deployed" value={formatRupees(summary.capitalDeployed)} />
        <KpiCard label="Gross P/L" value={formatRupees(summary.grossPnl)} tone={gain(summary.grossPnl)} delay={40} />
        <KpiCard label="Total Charges" value={summary.totalCharges > 0 ? `-${formatRupees(summary.totalCharges)}` : "0"} tone={summary.totalCharges > 0 ? "loss" : "neutral"} delay={80} />
        <KpiCard label="Overall P/L" value={formatRupees(summary.overallPnl)} tone={gain(summary.overallPnl)} delay={120} />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Total Trades" value={String(summary.totalTrades)} delay={160} />
        <KpiCard label="Profit Making Trades" value={formatPct(summary.profitMakingPct)} tone="gain" caption={`${summary.profitMakingTrades} of ${summary.totalTrades}`} delay={200} />
        <KpiCard label="Loss Making Trades" value={formatPct(summary.lossMakingPct)} tone="loss" caption={`${summary.lossMakingTrades} of ${summary.totalTrades}`} delay={240} />
      </div>
    </>
  );
}

function SwingStats({ summary, onEditPeriod }: { summary: SwingSummary; onEditPeriod: (p: Period) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        label="Average Holding Days"
        value={summary.averageHoldingDays === null ? "-" : summary.averageHoldingDays.toFixed(1)}
        caption="Shown on the app"
      />
      <PeriodCards periods={summary.periods} onEdit={onEditPeriod} />
    </div>
  );
}
