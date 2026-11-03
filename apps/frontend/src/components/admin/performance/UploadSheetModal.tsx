"use client";

import { useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  KIND_LABEL,
  MAX_SHEET_ROWS,
  SEGMENT_LABEL,
  SHEET_COLUMNS,
  SheetError,
  downloadSampleSheet,
  parseSheet,
  performanceApi,
  type BoardRef,
  type ImportSummary,
  type ParsedSheet,
  type PerformanceSegment,
} from "@/lib/performance";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

type Step = "choose" | "reading" | "checking" | "ready" | "importing";

/**
 * Upload a sheet of trades. The file is read in the browser, checked with a dry run (nothing is saved), and only
 * imported once the admin has seen what would be added, updated and skipped. Uploading again updates trades that
 * are already there, for example to add an Exit Date.
 */
export default function UploadSheetModal({
  board,
  segment,
  onClose,
  onDone,
}: {
  board: BoardRef;
  segment: PerformanceSegment;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("choose");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const busy = step === "reading" || step === "checking" || step === "importing";
  const toImport = preview ? preview.created + preview.updated : 0;

  function reset() {
    setStep("choose");
    setFile(null);
    setParsed(null);
    setPreview(null);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(f: File) {
    setFile(f);
    setParsed(null);
    setPreview(null);
    setProblem(null);
    setStep("reading");
    try {
      const sheet = await parseSheet(f, board.kind);
      setParsed(sheet);
      if (sheet.missing.length > 0 || sheet.rows.length === 0) {
        setStep("choose");
        return;
      }
      setStep("checking");
      setPreview(await performanceApi.importTrades(board.communityId, segment, sheet.rows, true));
      setStep("ready");
    } catch (err) {
      setProblem(err instanceof SheetError || err instanceof ApiError ? err.message : "Could not check that file");
      setFile(null);
      setParsed(null);
      setStep("choose");
    }
  }

  async function runImport() {
    if (!parsed || toImport === 0) return;
    setStep("importing");
    try {
      const result = await performanceApi.importTrades(board.communityId, segment, parsed.rows, false);
      const parts = [
        result.created > 0 && `${result.created} added`,
        result.updated > 0 && `${result.updated} updated`,
        result.errors.length > 0 && `${result.errors.length} skipped`,
      ].filter(Boolean);
      toast.success({ title: "Sheet uploaded", message: parts.join(", ") });
      onDone();
      onClose();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "The upload failed. Nothing was saved.");
      setStep("ready");
    }
  }

  const segmentName = board.kind === "investor" ? ` · ${SEGMENT_LABEL[segment]}` : "";
  const columns = SHEET_COLUMNS[board.kind];

  return (
    <Modal
      title="Upload sheet"
      subtitle={`${KIND_LABEL[board.kind]}${segmentName} · ${board.communityName}`}
      icon={<Upload size={18} />}
      size="lg"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void runImport()} disabled={step !== "ready" || toImport === 0} className={primaryBtn}>
            {step === "importing"
              ? "Uploading…"
              : toImport === 0
                ? "Nothing to upload"
                : preview && preview.errors.length > 0
                  ? `Upload ${toImport} valid trade${toImport === 1 ? "" : "s"}`
                  : `Upload ${toImport} trade${toImport === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="rounded-xl bg-background px-4 py-3 text-xs text-muted">
        <p>
          <span className="font-bold text-primary">Columns read: </span>
          {columns.join(", ")}.
        </p>
        <p className="mt-1">
          Other columns (returns, holding days, target price, free users) are calculated by the system and ignored. A trade already on the board is updated
          from its row, and a blank cell leaves the saved value as it is. Free-user settings are never changed by an upload.
        </p>
        <button
          type="button"
          onClick={() => downloadSampleSheet(board.kind)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:underline"
        >
          <Download size={12} /> Download a sample
        </button>
      </div>

      {file === null ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a sheet to upload, or drop one here"
          onDragOver={e => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 ${
            dragging ? "border-accent bg-accent/5" : "border-divider bg-background hover:border-accent/50"
          }`}
        >
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${dragging ? "bg-accent text-white" : "bg-white text-accent shadow-card"}`}>
            <Upload size={22} />
          </span>
          <p className="font-display text-base font-bold text-primary">{dragging ? "Drop to upload" : "Drag and drop your sheet here"}</p>
          <p className="text-sm text-muted">
            or <span className="font-bold text-accent">browse your computer</span>
          </p>
          <p className="text-xs text-subtle">.csv, .xlsx or .xls, up to 5 MB and {MAX_SHEET_ROWS.toLocaleString("en-IN")} rows</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-divider bg-white p-3.5 shadow-card">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <FileSpreadsheet size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-primary">{file.name}</p>
            <p className="text-xs text-muted">
              {step === "reading"
                ? "Reading…"
                : step === "checking"
                  ? "Checking the rows…"
                  : parsed
                    ? `${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} found`
                    : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            aria-label="Remove file"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="sr-only"
        tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {problem && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {problem}
        </p>
      )}

      {parsed && parsed.missing.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-bold">This sheet is missing a column: {parsed.missing.join(", ")}.</span> Found: {parsed.recognised.join(", ") || "none"}.
          </span>
        </p>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="New" value={preview.created} tone="text-emerald-600" />
            <Tile label="Updated" value={preview.updated} tone="text-accent" />
            <Tile label="Unchanged" value={preview.unchanged} tone="text-muted" />
          </div>

          {preview.errors.length > 0 && (
            <div>
              <p className="text-sm font-bold text-red-600">
                {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} will be skipped
              </p>
              <ul className="scrollbar-slim mt-2 max-h-44 divide-y divide-divider overflow-y-auto rounded-xl border border-divider text-xs">
                {preview.errors.map(e => (
                  <li key={e.row} className="flex gap-3 px-3 py-2">
                    <span className="w-14 shrink-0 font-bold text-primary">Row {e.row}</span>
                    <span className="w-28 shrink-0 truncate text-muted">{e.ref || "-"}</span>
                    <span className="text-red-600">{e.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-background px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
