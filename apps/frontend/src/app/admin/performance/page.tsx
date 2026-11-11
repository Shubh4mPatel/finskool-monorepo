"use client";

import { useCallback, useState } from "react";
import { ChartLine, Link2, Plus, Upload } from "lucide-react";
import {
  KIND_LABEL,
  KIND_ORDER,
  SEGMENT_LABEL,
  isHoldingSegment,
  performanceApi,
  type BoardListItem,
  type PerformanceKind,
  type PerformanceSegment,
} from "@/lib/performance";
import { useIsSuperAdmin } from "@/lib/session";
import { usePanel } from "@/components/admin/dashboard/usePanel";
import { Card, EmptyState, PanelError, Skeleton } from "@/components/admin/dashboard/Panel";
import BoardView from "@/components/admin/performance/BoardView";
import TradeModal from "@/components/admin/performance/TradeModal";
import UploadSheetModal from "@/components/admin/performance/UploadSheetModal";
import PeriodModal from "@/components/admin/performance/PeriodModal";
import LinkBoardModal from "@/components/admin/performance/LinkBoardModal";

function KindTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-5 py-2 text-xs font-bold transition-all duration-200 ${
        active ? "bg-primary text-white shadow-sm" : "text-muted hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}

export default function PerformancePage() {
  const isSuperAdmin = useIsSuperAdmin();
  const [boardsVersion, setBoardsVersion] = useState(0);
  const [reload, setReload] = useState(0);
  const [kindPick, setKindPick] = useState<PerformanceKind | null>(null);
  const [communityPick, setCommunityPick] = useState<string | null>(null);
  const [segmentPick, setSegmentPick] = useState<PerformanceSegment | null>(null);
  const [modal, setModal] = useState<"upload" | "trade" | "period" | "link" | null>(null);

  const bump = useCallback(() => setReload(n => n + 1), []);
  const boards = usePanel(`boards:${boardsVersion}`, () => performanceApi.boards());

  const all = boards.data?.boards ?? [];
  const byKind = (k: PerformanceKind): BoardListItem[] => all.filter(b => b.kind === k);
  // A super admin can link a board from any tab; everyone else sees only the kinds they manage.
  const kinds = KIND_ORDER.filter(k => isSuperAdmin === true || byKind(k).length > 0);
  const kind = kindPick !== null && kinds.includes(kindPick) ? kindPick : (kinds[0] ?? null);

  const ofKind = kind ? byKind(kind) : [];
  const board = ofKind.find(b => b.communityId === communityPick) ?? ofKind[0] ?? null;
  const segment: PerformanceSegment | null = board ? (board.segments.find(s => s === segmentPick) ?? board.segments[0] ?? null) : null;
  const ref = board ? { communityId: board.communityId, communityName: board.name, kind: board.kind } : null;
  // Hit-rate period cards need targets; Long Term and US Investment have none.
  const hasPeriods = board !== null && board.kind !== "intraday" && segment !== null && !isHoldingSegment(segment);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Performance</p>
          <h1 className="font-display text-2xl font-bold text-primary">Performance</h1>
          <p className="mt-1 text-sm text-muted">Trades and results shown on each community&apos;s Performance screen.</p>
        </div>
        {board && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setModal("upload")}
              className="flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2 text-sm font-bold text-primary shadow-card transition-all hover:border-subtle"
            >
              <Upload size={14} />
              Upload sheet
            </button>
            <button
              type="button"
              onClick={() => setModal("trade")}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
              style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
            >
              <Plus size={14} />
              Add trade
            </button>
          </div>
        )}
      </div>

      {boards.error ? (
        <Card>
          <PanelError message={boards.error} onRetry={boards.retry} />
        </Card>
      ) : !boards.data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : kind === null ? (
        <Card>
          <EmptyState icon={<ChartLine size={18} />}>No Performance board is set up for your communities yet. Ask a super admin to link one.</EmptyState>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div role="group" aria-label="Board" className="flex w-fit rounded-full bg-white p-1 shadow-card">
                {kinds.map(k => (
                  <KindTab key={k} active={k === kind} label={KIND_LABEL[k]} onClick={() => setKindPick(k)} />
                ))}
              </div>
              {ofKind.length > 1 && (
                <select
                  aria-label="Community"
                  value={board?.communityId ?? ""}
                  onChange={e => setCommunityPick(e.target.value)}
                  className="rounded-full border border-divider bg-white px-4 py-2 text-xs font-bold text-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15"
                >
                  {ofKind.map(b => (
                    <option key={b.communityId} value={b.communityId}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {hasPeriods && (
              <button
                type="button"
                onClick={() => setModal("period")}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-accent/50 bg-white px-4 py-2 text-xs font-bold text-accent transition-colors hover:bg-accent/5"
              >
                <Plus size={13} />
                Add period
              </button>
            )}
          </div>

          {board && board.segments.length > 1 && segment && (
            <div role="tablist" aria-label="Segment" className="flex gap-6 border-b border-divider">
              {board.segments.map(s => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={s === segment}
                  onClick={() => setSegmentPick(s)}
                  className={`-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors ${
                    s === segment ? "border-primary text-primary" : "border-transparent text-muted hover:text-primary"
                  }`}
                >
                  {SEGMENT_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          {board && segment ? (
            <BoardView key={`${board.communityId}:${segment}`} board={board} segment={segment} reload={reload} onChanged={bump} />
          ) : (
            <Card>
              <EmptyState icon={<Link2 size={18} />}>
                {isSuperAdmin
                  ? `No community has a ${KIND_LABEL[kind]} board yet.`
                  : `There is no ${KIND_LABEL[kind]} board for your communities.`}
              </EmptyState>
              {isSuperAdmin && (
                <div className="flex justify-center pb-4">
                  <button
                    type="button"
                    onClick={() => setModal("link")}
                    className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#1c4c48]"
                  >
                    <Link2 size={14} />
                    Link a community
                  </button>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {modal === "upload" && ref && segment && <UploadSheetModal board={ref} segment={segment} onClose={() => setModal(null)} onDone={bump} />}
      {modal === "trade" && ref && segment && <TradeModal board={ref} segment={segment} onClose={() => setModal(null)} onDone={bump} />}
      {modal === "period" && ref && segment && <PeriodModal board={ref} segment={segment} onClose={() => setModal(null)} onDone={bump} />}
      {modal === "link" && kind && boards.data && (
        <LinkBoardModal
          unlinked={boards.data.unlinked}
          initialKind={kind}
          onClose={() => setModal(null)}
          onDone={linked => {
            setKindPick(linked);
            setCommunityPick(null);
            setBoardsVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
}
