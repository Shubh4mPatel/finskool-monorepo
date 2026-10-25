"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Info,
  Pencil,
  RefreshCw,
  Upload,
  Users,
  X,
} from "lucide-react";
import { isValidPhoneNumber, parsePhoneNumberFromString } from "libphonenumber-js";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import Stepper from "@/components/admin/Stepper";
import { CountUp } from "@/components/admin/dashboard/CountUp";
import { EmptyState, Pill, stagger, TH } from "@/components/admin/dashboard/Panel";

type Step = 1 | 2 | 3;
type Strategy = "skip" | "overwrite";
type PreviewFilter = "all" | "issues" | "ready";

interface ParsedRow {
  rowNum: number;
  name: string;
  phone: string;
  email: string;
  service: string;
  payment: string;
  paidOn: string;
  valid: string;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
  // Set only when the phone matches an existing member who isn't active — needs an
  // explicit admin decision (the `revive` checkbox below) rather than being silently
  // reactivated, or silently skipped, during import.
  existingStatus?: "suspended" | "deleted";
  revive: boolean;
  // Edited in the preview since the last validation — its status is unknown until re-validated.
  edited?: boolean;
}

interface ValidateRowResult {
  rowNum: number;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
  existingStatus?: "suspended" | "deleted";
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; phone: string; reason: string }[];
}

const PAGE_SIZE = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const STEPS = ["Upload File", "Preview & Review", "Confirm Import"];

const COLUMNS: { name: string; required: boolean; hint: string }[] = [
  { name: "Name", required: true, hint: "Full name" },
  { name: "Contact Number", required: true, hint: "Mobile number, +91 optional" },
  { name: "Service", required: true, hint: "Exact community name" },
  { name: "Payment", required: true, hint: "A plain number, e.g. 4000" },
  { name: "Valid", required: true, hint: "Valid-till date" },
  { name: "Paid on", required: false, hint: "Date the payment was made" },
  { name: "Email", required: false, hint: "Can be left blank" },
];
const REQUIRED_COLUMNS = COLUMNS.filter((c) => c.required).map((c) => c.name);

function normalizePhone(raw: string): string {
  const phone = parsePhoneNumberFromString(raw, "IN");
  return phone?.isValid() ? phone.number : raw.trim();
}

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const toValidatePayload = (rows: ParsedRow[]) =>
  rows.map((r) => ({
    rowNum: r.rowNum,
    name: r.name,
    phone: r.phone,
    email: r.email,
    service: r.service,
    payment: parseFloat(r.payment) || 0,
    valid: r.valid,
    ...(r.paidOn ? { paidOn: r.paidOn } : {}),
  }));

// ── An editable table cell ───────────────────────────────────────────────────
// Declared at module level on purpose: a component defined inside the render loop gets a new
// identity every render and re-mounts — losing focus — on every keystroke.

type EditableField = "name" | "phone" | "payment" | "paidOn" | "valid" | "service" | "email";

function EditableCell({
  label,
  value,
  editing,
  editValue,
  onEditValue,
  onStart,
  onCommit,
  onCancel,
  serviceNames,
  className = "",
  isService = false,
}: {
  label: string;
  value: string;
  editing: boolean;
  editValue: string;
  onEditValue: (v: string) => void;
  onStart: () => void;
  onCommit: (override?: string) => void;
  onCancel: () => void;
  serviceNames: string[];
  className?: string;
  isService?: boolean;
}) {
  const field =
    "w-full rounded-lg border border-accent bg-white px-2 py-1.5 text-xs text-primary focus:outline-none focus:ring-4 focus:ring-accent/10";
  if (editing) {
    return isService ? (
      <select
        autoFocus
        value={editValue}
        aria-label={label}
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCommit()}
        className={field}
      >
        <option value="">Select community</option>
        {serviceNames.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    ) : (
      <input
        autoFocus
        value={editValue}
        aria-label={label}
        onChange={(e) => onEditValue(e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        className={field}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      title={`Edit ${label.toLowerCase()}`}
      className={`group flex w-full items-center gap-1.5 rounded-md text-left transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
    >
      <span className="truncate">{value || "—"}</span>
      <Pencil size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50" aria-hidden />
    </button>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "danger" | "warning" }) {
  const styles = {
    neutral: "bg-background text-primary",
    success: "bg-lime/40 text-primary",
    danger: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-700",
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 ${styles}`}>
      <p className="font-display text-2xl font-bold leading-none tabular-nums">{value.toLocaleString("en-IN")}</p>
      <p className="mt-1.5 text-xs font-semibold opacity-80">{label}</p>
    </div>
  );
}

export default function ImportCSVPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<{ missing: string[]; empty: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const strategy: Strategy = "overwrite";
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [communityNames, setCommunityNames] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [editCell, setEditCell] = useState<{ rowNum: number; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [needsRevalidation, setNeedsRevalidation] = useState(false);

  // Loaded on first use rather than on mount: a file can only be dropped once it's known which
  // communities are valid, and the lookup is lowercase for matching but proper-case for display.
  const communitiesLoaded = useRef<Promise<string[]> | null>(null);
  function loadCommunities(): Promise<string[]> {
    communitiesLoaded.current ??= api
      .get<{ id: string; name: string }[]>("/api/v1/admin/communities")
      .then((cs) => {
        const names = cs.map((c) => c.name);
        setCommunityNames(names);
        return names;
      })
      .catch(() => {
        communitiesLoaded.current = null; // don't remember a failure — the next attempt asks again
        return [];
      });
    return communitiesLoaded.current;
  }

  const errorRows = rows.filter((r) => r.errors.length > 0);
  const validRows = rows.filter((r) => r.errors.length === 0);
  const existingRows = validRows.filter((r) => r.existingStatus || r.warnings.length > 0);

  const visibleRows = useMemo(
    () =>
      rows.filter((r) =>
        previewFilter === "issues" ? r.errors.length > 0 : previewFilter === "ready" ? r.errors.length === 0 : true,
      ),
    [rows, previewFilter],
  );
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(previewPage, totalPages);
  const pageRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function parseAndValidate(f: File, communityList: string[]) {
    const lower = communityList.map((c) => c.toLowerCase());
    setParsing(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setParsing(false);
      setFile(null);
      toast.error("Couldn't read that file. Try saving it again as a .csv or .xlsx.");
    };
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", raw: false, cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]!];
        const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        // Normalize header keys — trim whitespace so "Valid " matches "Valid"
        const jsonRows = rawRows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "").trim()])),
        );

        const headers = new Set(Object.keys(jsonRows[0] ?? {}));
        setParseNote({
          empty: jsonRows.length === 0,
          missing: jsonRows.length > 0 ? REQUIRED_COLUMNS.filter((c) => !headers.has(c)) : [],
        });

        const parsed: ParsedRow[] = jsonRows.map((row, i) => {
          const get = (key: string) => String(row[key] ?? "").trim();
          const name = get("Name");
          const phone = get("Contact Number");
          const email = get("Email");
          const service = get("Service");
          const rawPayment = get("Payment");
          const payment = rawPayment.replace(/[^0-9.]/g, "");
          const paidOn = get("Paid on");
          const valid = get("Valid");
          const errors: string[] = [];

          if (!name) errors.push("Name required");
          if (!phone) errors.push("Phone required");
          else if (!isValidPhoneNumber(phone, "IN")) errors.push("Invalid phone");
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email");
          if (!service) errors.push("Service required");
          else if (!lower.includes(service.toLowerCase())) errors.push(`Community not found`);
          if (/[+\-*/]/.test(rawPayment)) errors.push(`Payment contains expression "${rawPayment}" — enter a plain number`);
          else if (!payment || isNaN(parseFloat(payment))) errors.push("Invalid payment amount");
          if (!valid) errors.push("Valid date required");

          return {
            rowNum: i + 2,
            name,
            phone: phone ? normalizePhone(phone) : "",
            email,
            service,
            payment,
            paidOn,
            valid,
            errors,
            warnings: [],
            isDuplicate: false,
            revive: false,
          };
        });

        setRows(parsed);
        setPreviewPage(1);
      } catch {
        setFile(null);
        setRows([]);
        toast.error("Couldn't read that file. Try saving it again as a .csv or .xlsx.");
      } finally {
        setParsing(false);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleFile(f: File) {
    if (!/\.(csv|xlsx|xls)$/i.test(f.name)) {
      toast.error("Please choose a .csv, .xlsx or .xls file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(`That file is ${formatSize(f.size)} — the limit is 5 MB. Split it into smaller files.`);
      return;
    }
    setFile(f);
    setRows([]);
    setParseNote(null);
    const names = await loadCommunities();
    if (names.length === 0) {
      // Without the community list every row would be flagged "Community not found".
      setFile(null);
      toast.error("Couldn't load your communities, so the file can't be checked yet. Please try again.");
      return;
    }
    parseAndValidate(f, names);
  }

  function clearFile() {
    setFile(null);
    setRows([]);
    setParseNote(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function validateAndPreview() {
    if (!file || rows.length === 0) return;
    setValidating(true);
    let merged = rows;
    try {
      const { results } = await api.post<{ results: ValidateRowResult[] }>("/api/v1/admin/validate-import", {
        rows: toValidatePayload(rows),
      });
      merged = rows.map((r) => {
        const validation = results.find((v) => v.rowNum === r.rowNum);
        if (!validation) return r;
        return {
          ...r,
          errors: validation.errors.length > 0 ? validation.errors : r.errors,
          warnings: validation.warnings,
          isDuplicate: validation.isDuplicate,
          existingStatus: validation.existingStatus,
        };
      });
      setRows(merged);
    } catch {
      toast.error("Validation failed. Please try again.");
    } finally {
      setValidating(false);
    }
    setPreviewFilter("all");
    setPreviewPage(1);
    setStep(2);
    if (merged.some((r) => r.errors.length > 0)) setShowErrorModal(true);
  }

  function startEdit(r: ParsedRow, field: EditableField) {
    setEditCell({ rowNum: r.rowNum, field });
    setEditValue(r[field]);
  }

  function commitEdit(override?: string) {
    if (!editCell) return;
    const value = override ?? editValue;
    setRows((prev) =>
      prev.map((r) =>
        r.rowNum === editCell.rowNum
          ? { ...r, [editCell.field]: value, errors: [], warnings: [], isDuplicate: false, existingStatus: undefined, revive: false, edited: true }
          : r,
      ),
    );
    setEditCell(null);
    setNeedsRevalidation(true);
  }

  async function revalidate() {
    setValidating(true);
    try {
      const { results } = await api.post<{ results: ValidateRowResult[] }>("/api/v1/admin/validate-import", {
        rows: toValidatePayload(rows),
      });
      setRows((prev) =>
        prev.map((r) => {
          const v = results.find((x) => x.rowNum === r.rowNum);
          if (!v) return r;
          // A row's revive selection only survives if it still matches the same
          // suspended/deleted member as before — any change (edited row, or the
          // member's status itself changed) resets it, so a stale checkbox can
          // never carry over onto a different account.
          const revive = v.existingStatus && v.existingStatus === r.existingStatus ? r.revive : false;
          return { ...r, errors: v.errors, warnings: v.warnings, isDuplicate: v.isDuplicate, existingStatus: v.existingStatus, revive, edited: false };
        }),
      );
      setNeedsRevalidation(false);
      if (results.some((v) => v.errors.length > 0)) setShowErrorModal(true);
    } catch {
      toast.error("Validation failed. Please try again.");
    } finally {
      setValidating(false);
    }
  }

  function toggleRevive(rowNum: number) {
    setRows((prev) => prev.map((r) => (r.rowNum === rowNum ? { ...r, revive: !r.revive } : r)));
  }

  async function handleConfirmImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const payload = {
        strategy,
        rows: validRows.map((r) => ({
          name: r.name,
          phone: r.phone,
          email: r.email,
          service: r.service,
          payment: parseFloat(r.payment),
          valid: r.valid,
          ...(r.paidOn ? { paidOn: r.paidOn } : {}),
        })),
        // Row numbers the admin explicitly checked to reactivate a suspended/deleted
        // member — any other row matching one is skipped server-side instead.
        reviveRowNums: validRows.filter((r) => r.revive).map((r) => r.rowNum),
      };
      const data = await api.post<ImportResult>("/api/v1/admin/import-json", payload);
      setResult(data);
      setStep(3);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  async function downloadSample() {
    // One example row per real community — using a fixed/placeholder community name here would
    // just fail the importer's own "Service" validation against actual community names.
    const names = communityNames.length > 0 ? communityNames : await loadCommunities();
    const header = ["Name", "Contact Number", "Payment", "Paid on", "Valid", "Service", "Email"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const sources = names.length > 0 ? names : ["Your Community Name"];
    const sampleRows = sources.map((name, i) => [
      `Sample Member ${i + 1}`,
      `98765432${String(i).padStart(2, "0")}`,
      "999",
      "2026-01-05",
      "2026-12-31",
      name,
      `sample${i + 1}@example.com`,
    ]);
    const csv = [header, ...sampleRows].map((r) => r.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-import.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function startOver() {
    setStep(1);
    setFile(null);
    setRows([]);
    setParseNote(null);
    setResult(null);
    setNeedsRevalidation(false);
    setEditCell(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const tabs: { key: PreviewFilter; label: string; count: number }[] = [
    { key: "all", label: "All rows", count: rows.length },
    { key: "issues", label: "Needs attention", count: errorRows.length },
    { key: "ready", label: "Ready", count: validRows.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Import CSV</p>
          <h1 className="font-display text-2xl font-bold text-primary">Import Members</h1>
          <p className="mt-1 text-sm text-muted">Upload a CSV or Excel file to add or update members in bulk.</p>
        </div>
        <Link
          href="/admin/members"
          className="inline-flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-all hover:border-accent hover:text-accent"
        >
          <Users size={14} />
          View members
        </Link>
      </div>

      <section className="animate-enter rounded-2xl bg-white p-6 shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "60ms" }}>
        <Stepper steps={STEPS} current={step} />

        {/* ── Step 1: Upload ── */}
        {step === 1 && (
          <div key="step-1" className="animate-enter mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <h2 className="font-display text-base font-bold text-primary">Upload your file</h2>

              <div
                role="button"
                tabIndex={0}
                aria-label="Choose a file to upload, or drop one here"
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void handleFile(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`flex min-h-80 flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 ${
                  dragging ? "scale-[1.01] border-accent bg-accent/5" : "border-divider bg-background hover:border-accent/50"
                }`}
              >
                <span
                  className={`flex h-20 w-20 items-center justify-center rounded-3xl transition-colors ${
                    dragging ? "bg-accent text-white" : "bg-white text-accent shadow-card"
                  }`}
                >
                  <Upload size={32} className={dragging ? "animate-bounce" : ""} />
                </span>
                <p className="font-display text-lg font-bold text-primary">{dragging ? "Drop to upload" : "Drag and drop your file here"}</p>
                <p className="text-sm text-muted">
                  or <span className="font-bold text-accent underline-offset-2 hover:underline">browse your computer</span>
                </p>
                <p className="text-xs text-subtle">CSV or Excel (.csv, .xlsx, .xls), max 5 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </div>

              {file && (
                <div className="animate-enter flex flex-wrap items-center gap-3 rounded-2xl border border-divider bg-white p-3.5 shadow-card">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <FileSpreadsheet size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-primary">{file.name}</p>
                    <p className="text-xs text-muted">
                      {formatSize(file.size)}
                      {parsing ? " · reading…" : rows.length > 0 ? ` · ${rows.length} row${rows.length === 1 ? "" : "s"} found` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Remove file"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {parseNote?.empty && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  No rows were found in this file. Check that the first row has the column headings.
                </p>
              )}
              {parseNote && parseNote.missing.length > 0 && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Missing column{parseNote.missing.length === 1 ? "" : "s"}: <strong>{parseNote.missing.join(", ")}</strong>. Every row will
                    be flagged until the file has {parseNote.missing.length === 1 ? "it" : "them"}.
                  </span>
                </p>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => void validateAndPreview()}
                  disabled={!file || rows.length === 0 || validating || parsing}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  {validating ? "Validating…" : "Upload & Preview"}
                  {!validating && <ArrowRight size={15} className="text-lime" />}
                </button>
              </div>
            </div>

            {/* File format guide */}
            <aside className="flex flex-col gap-3 rounded-2xl bg-background p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-primary">File format</h3>
                  <p className="mt-0.5 text-xs text-muted">The first row must be these headings.</p>
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                {COLUMNS.map((c) => (
                  <li key={c.name} className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-primary">{c.name}</span>
                      <span className="block text-[11px] text-muted">{c.hint}</span>
                    </span>
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        c.required ? "bg-lime/50 text-primary" : "bg-divider text-muted"
                      }`}
                    >
                      {c.required ? "Required" : "Optional"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => void downloadSample()}
                className="mt-1 flex items-center justify-center gap-2 rounded-full border border-accent px-4 py-2 text-sm font-bold text-accent transition-colors hover:bg-accent/5"
              >
                <Download size={14} /> Download sample CSV
              </button>
            </aside>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 2 && (
          <div key="step-2" className="animate-enter mt-8 flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-primary">Review your data</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <Info size={12} aria-hidden /> Click any cell to fix it. Rows with issues are skipped on import.
                </p>
              </div>
              {errorRows.length > 0 && (
                <button
                  onClick={() => setShowErrorModal(true)}
                  className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                >
                  <AlertTriangle size={14} />
                  View {errorRows.length} issue{errorRows.length === 1 ? "" : "s"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryTile label="Rows in file" value={rows.length} tone="neutral" />
              <SummaryTile label="Ready to import" value={validRows.length} tone="success" />
              <SummaryTile label="Need attention" value={errorRows.length} tone="danger" />
              <SummaryTile label="Already members" value={existingRows.length} tone="warning" />
            </div>

            <div role="group" aria-label="Filter rows" className="flex w-fit max-w-full flex-wrap rounded-full bg-background p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={previewFilter === t.key}
                  onClick={() => { setPreviewFilter(t.key); setPreviewPage(1); }}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ${
                    previewFilter === t.key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${previewFilter === t.key ? "bg-lime text-primary" : "bg-divider text-muted"}`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {pageRows.length === 0 ? (
              <EmptyState icon={<CheckCircle2 size={20} />}>
                {previewFilter === "issues" ? "No rows need attention. Nice!" : "No rows to show."}
              </EmptyState>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-240 text-left text-sm">
                  <thead>
                    <tr className="bg-background">
                      {["Row", "Name", "Phone", "Payment", "Paid on", "Valid", "Service", "Email", "Status"].map((h, i, all) => (
                        <th
                          key={h}
                          scope="col"
                          className={`${TH} ${i === 0 ? "rounded-l-xl" : ""} ${i === all.length - 1 ? "rounded-r-xl" : ""}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => {
                      const hasError = r.errors.length > 0;
                      const hasWarning = !hasError && (r.warnings.length > 0 || !!r.existingStatus);
                      const cell = (field: EditableField, label: string, className = "") => (
                        <EditableCell
                          label={label}
                          value={r[field]}
                          editing={editCell?.rowNum === r.rowNum && editCell.field === field}
                          editValue={editValue}
                          onEditValue={setEditValue}
                          onStart={() => startEdit(r, field)}
                          onCommit={commitEdit}
                          onCancel={() => setEditCell(null)}
                          serviceNames={communityNames}
                          isService={field === "service"}
                          className={className}
                        />
                      );
                      return (
                        <tr
                          key={r.rowNum}
                          style={stagger(Math.min(i, 8), 0, 35)}
                          className={`animate-fade border-b border-divider/70 transition-colors last:border-0 ${
                            hasError ? "bg-red-50/40" : hasWarning ? "bg-amber-50/50" : "hover:bg-background/60"
                          }`}
                        >
                          <td className="px-3 py-3 text-xs tabular-nums text-subtle">{r.rowNum}</td>
                          <td className="px-3 py-3">
                            {cell("name", "Name", `font-bold ${hasError ? "text-red-600" : hasWarning ? "text-amber-700" : "text-primary"}`)}
                          </td>
                          <td className="px-3 py-3 text-muted">{cell("phone", "Phone")}</td>
                          <td className="px-3 py-3 text-muted">{cell("payment", "Payment")}</td>
                          <td className="px-3 py-3 text-muted">{cell("paidOn", "Paid on")}</td>
                          <td className="px-3 py-3 text-muted">{cell("valid", "Valid")}</td>
                          <td className="px-3 py-3 text-muted">{cell("service", "Service")}</td>
                          <td className="max-w-[12rem] px-3 py-3 text-muted">{cell("email", "Email")}</td>
                          <td className="px-3 py-3">
                            {hasError ? (
                              <button
                                type="button"
                                onClick={() => setShowErrorModal(true)}
                                title={r.errors.join(" · ")}
                                className="text-left"
                              >
                                <Pill tone="danger" dot>
                                  {r.errors.length} issue{r.errors.length === 1 ? "" : "s"}
                                </Pill>
                                <span className="mt-1 block max-w-[12rem] truncate text-[11px] text-red-500">{r.errors[0]}</span>
                              </button>
                            ) : r.existingStatus ? (
                              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">
                                <input
                                  type="checkbox"
                                  checked={r.revive}
                                  onChange={() => toggleRevive(r.rowNum)}
                                  className="h-3.5 w-3.5 accent-red-600"
                                />
                                Revive ({r.existingStatus})
                              </label>
                            ) : r.edited ? (
                              <Pill tone="info" dot>Edited</Pill>
                            ) : hasWarning ? (
                              <span title={r.warnings.join(" · ")}>
                                <Pill tone="warning" dot>Exists</Pill>
                              </span>
                            ) : (
                              <Pill tone="success" dot>Ready</Pill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <nav aria-label="Pages" className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setPreviewPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
                >
                  <ChevronLeft size={15} /> Previous
                </button>
                <span className="text-sm tabular-nums text-muted">
                  Page <span className="font-semibold text-primary">{currentPage}</span> of {totalPages}
                </span>
                <button
                  onClick={() => setPreviewPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
                >
                  Next <ChevronRight size={15} />
                </button>
              </nav>
            )}

            {/* Action bar */}
            <div className="sticky bottom-0 z-10 -mx-2 mt-1 rounded-2xl bg-white/95 px-4 py-3 shadow-card-hover ring-1 ring-primary/[0.06] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-muted">
                  {needsRevalidation ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                      <AlertTriangle size={13} /> You edited rows — re-validate before importing.
                    </span>
                  ) : (
                    <>
                      <span className="tabular-nums text-primary">{validRows.length}</span> ready
                      {errorRows.length > 0 && (
                        <>
                          {" · "}
                          <span className="tabular-nums text-red-500">{errorRows.length}</span> with issues will be skipped
                        </>
                      )}
                    </>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={startOver}
                    className="rounded-full border border-divider bg-white px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
                  >
                    Start over
                  </button>
                  {needsRevalidation && (
                    <button
                      onClick={() => void revalidate()}
                      disabled={validating}
                      className="animate-fade flex items-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/5 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={validating ? "animate-spin" : ""} />
                      {validating ? "Validating…" : "Re-validate"}
                    </button>
                  )}
                  <button
                    onClick={() => void handleConfirmImport()}
                    disabled={importing || validRows.length === 0 || needsRevalidation}
                    className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                  >
                    <CheckCircle2 size={15} className="text-lime" />
                    {importing ? "Importing…" : `Import ${validRows.length} member${validRows.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Success ── */}
        {step === 3 && result && (
          <div key="step-3" className="animate-enter mt-10 flex flex-col items-center gap-5 pb-8 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#245a55] text-lime shadow-glow">
              <CheckCircle2 size={38} />
            </span>
            <div>
              <h2 className="font-display text-2xl font-bold text-primary">Import complete</h2>
              <p className="mt-1 text-sm text-muted">
                {result.created + result.updated} of {result.total} row{result.total === 1 ? "" : "s"} went through.
              </p>
            </div>

            <div className="grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-lime/40 px-4 py-3">
                <p className="font-display text-2xl font-bold tabular-nums text-primary"><CountUp value={result.created} /></p>
                <p className="mt-1 text-xs font-semibold text-primary/70">Added</p>
              </div>
              <div className="rounded-2xl bg-accent/10 px-4 py-3">
                <p className="font-display text-2xl font-bold tabular-nums text-primary"><CountUp value={result.updated} /></p>
                <p className="mt-1 text-xs font-semibold text-primary/70">Updated</p>
              </div>
              <div className="rounded-2xl bg-background px-4 py-3">
                <p className="font-display text-2xl font-bold tabular-nums text-primary"><CountUp value={result.skipped} /></p>
                <p className="mt-1 text-xs font-semibold text-muted">Skipped</p>
              </div>
              <div className={`rounded-2xl px-4 py-3 ${result.errors.length > 0 ? "bg-red-50" : "bg-background"}`}>
                <p className={`font-display text-2xl font-bold tabular-nums ${result.errors.length > 0 ? "text-red-600" : "text-primary"}`}>
                  <CountUp value={result.errors.length} />
                </p>
                <p className={`mt-1 text-xs font-semibold ${result.errors.length > 0 ? "text-red-500" : "text-muted"}`}>Errors</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="w-full max-w-xl rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-700">
                  <AlertTriangle size={13} /> Rows with errors
                </p>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto scrollbar-slim">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-600">
                      <span className="font-bold">Row {e.row}</span> ({e.phone}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={startOver}
                className="rounded-full border border-divider bg-white px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Import another file
              </button>
              <Link
                href="/admin/members"
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                View members <ArrowRight size={15} className="text-lime" />
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Validation issues */}
      {step === 2 && showErrorModal && (
        <Modal
          title="Validation issues"
          subtitle={`${errorRows.length} row${errorRows.length === 1 ? "" : "s"} can't be imported yet`}
          icon={<AlertTriangle size={18} />}
          iconClass="bg-red-100 text-red-600"
          size="lg"
          onClose={() => setShowErrorModal(false)}
          footer={
            <button
              onClick={() => setShowErrorModal(false)}
              className="ml-auto rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
            >
              Got it
            </button>
          }
        >
          <p className="text-xs text-muted">Click a cell in the table to fix it, then re-validate. Or leave them — they&apos;ll simply be skipped.</p>
          <div className="-mx-1 max-h-[50vh] overflow-y-auto scrollbar-slim">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pb-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted">Row</th>
                  <th className="pb-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted">Name</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Issue</th>
                </tr>
              </thead>
              <tbody>
                {errorRows.map((r) => (
                  <tr key={r.rowNum} className="border-t border-divider">
                    <td className="py-3 pr-4 font-mono text-xs text-subtle">{r.rowNum}</td>
                    <td className="py-3 pr-4 font-bold text-primary">{r.name || "—"}</td>
                    <td className="py-3">
                      <ul className="flex flex-col gap-1">
                        {r.errors.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-red-600">
                            <span className="mt-0.5 shrink-0 text-red-400">•</span>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
