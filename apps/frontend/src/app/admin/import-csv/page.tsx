"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle, Download, Pencil, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Step = 1 | 2 | 3;
type Strategy = "skip" | "overwrite";

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
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; phone: string; reason: string }[];
}

const PAGE_SIZE = 10;
const STEPS = ["Upload File", "Preview & Review", "Confirm Import"];

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim().replace(/\s/g, "");
  return raw.trim();
}

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = current > n;
        const active = current === n;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${done || active ? "bg-primary text-white" : "bg-divider text-subtle"}`}>
                {done ? <CheckCircle size={15} /> : n}
              </div>
              <span className={`text-sm font-semibold ${active ? "text-primary" : done ? "text-primary" : "text-subtle"}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-4 h-px w-16 sm:w-28 ${current > n ? "bg-primary" : "bg-divider"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ImportCSVPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const strategy: Strategy = "overwrite";
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [communities, setCommunities] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [editCell, setEditCell] = useState<{ rowNum: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [needsRevalidation, setNeedsRevalidation] = useState(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>("/api/v1/admin/communities")
      .then(cs => setCommunities(cs.map(c => c.name.toLowerCase())))
      .catch(() => {});
  }, []);

  const errorRows = rows.filter(r => r.errors.length > 0);

  useEffect(() => {
    if (step === 2 && errorRows.length > 0) {
      setShowErrorModal(true);
    }
  }, [step]);

  function parseAndValidate(f: File, communityList: string[]) {
    const reader = new FileReader();
    reader.onload = e => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", raw: false, cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      // Normalize header keys — trim whitespace so "Valid " matches "Valid"
      const jsonRows = rawRows.map(r =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "").trim()]))
      );

      const parsed: ParsedRow[] = jsonRows.map((row, i) => {
        const get = (key: string) => String(row[key] ?? "").trim();
        const name    = get("Name");
        const phone   = get("Contact Number");
        const email   = get("Email");
        const service = get("Service");
        const rawPayment = get("Payment");
        const payment = rawPayment.replace(/[^0-9.]/g, "");
        const paidOn  = get("Paid on");
        const valid   = get("Valid");
        const errors: string[] = [];

        if (!name)    errors.push("Name required");
        if (!phone)   errors.push("Phone required");
        else if (!/^\d{10,12}$/.test(phone.replace(/\D/g, "")) && !/^\+[1-9]\d{6,14}$/.test(phone))
          errors.push("Invalid phone");
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email");
        if (!service) errors.push("Service required");
        else if (!communityList.includes(service.toLowerCase()))
          errors.push(`Community not found`);
        if (/[+\-*/]/.test(rawPayment)) errors.push(`Payment contains expression "${rawPayment}" — enter a plain number`);
        else if (!payment || isNaN(parseFloat(payment))) errors.push("Invalid payment amount");
        if (!valid) errors.push("Valid date required");

        return {
          rowNum: i + 2,
          name, phone: phone ? normalizePhone(phone) : "",
          email, service, payment, paidOn, valid,
          errors, warnings: [], isDuplicate: false,
        };
      });

      setRows(parsed);
      setPreviewPage(1);
    };
    reader.readAsArrayBuffer(f);
  }

  function handleFile(f: File) {
    setFile(f);
    parseAndValidate(f, communities);
  }

  function commitEdit() {
    if (!editCell) return;
    setRows(prev => prev.map(r =>
      r.rowNum === editCell.rowNum
        ? { ...r, [editCell.field]: editValue, errors: [], warnings: [], isDuplicate: false }
        : r
    ));
    setEditCell(null);
    setNeedsRevalidation(true);
  }

  async function revalidate() {
    setValidating(true);
    try {
      const payload = rows.map(r => ({
        rowNum: r.rowNum,
        name: r.name,
        phone: r.phone,
        email: r.email,
        service: r.service,
        payment: parseFloat(r.payment) || 0,
        valid: r.valid,
        ...(r.paidOn ? { paidOn: r.paidOn } : {}),
      }));
      const { results } = await api.post<{ results: { rowNum: number; errors: string[]; warnings: string[]; isDuplicate: boolean }[] }>(
        "/api/v1/admin/validate-import",
        { rows: payload }
      );
      setRows(prev => prev.map(r => {
        const v = results.find(x => x.rowNum === r.rowNum);
        if (!v) return r;
        return { ...r, errors: v.errors, warnings: v.warnings, isDuplicate: v.isDuplicate };
      }));
      setNeedsRevalidation(false);
      if (results.some(v => v.errors.length > 0)) setShowErrorModal(true);
    } catch {
      toast.error("Validation failed. Please try again.");
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirmImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const payload = {
        strategy,
        rows: validRows.map(r => ({
          name: r.name,
          phone: r.phone,
          email: r.email,
          service: r.service,
          payment: parseFloat(r.payment),
          valid: r.valid,
          ...(r.paidOn ? { paidOn: r.paidOn } : {}),
        })),
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

  function downloadSample() {
    const csv = `Name,Contact Number,Payment,Paid on,Valid,Service,Email\nAmit Sharma,9876543201,999,2026-01-05,2026-12-31,Swing Alpha Community,amit@example.com\nPriya Verma,9876543202,1499,2026-01-06,2026-12-31,Investor Community,priya@example.com`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "sample-import.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const validRows  = rows.filter(r => r.errors.length === 0);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows   = rows.slice((previewPage - 1) * PAGE_SIZE, previewPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Import CSV</p>
        <h1 className="font-display text-2xl font-bold text-primary">Import Members</h1>
        <p className="mt-1 text-sm text-muted">Upload a CSV file to add or update members in bulk.</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <StepBar current={step} />

        {/* ── Step 1: Upload ── */}
        {step === 1 && (
          <div className="mt-8 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-primary">Upload CSV File</h2>
              <button onClick={downloadSample} className="flex items-center gap-2 rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent transition-all hover:bg-accent/5">
                <Download size={14} /> Download Sample CSV
              </button>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault(); setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f && /\.(csv|xlsx|xls)$/i.test(f.name)) handleFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-colors ${dragging ? "border-accent bg-accent/5" : "border-divider bg-background hover:border-accent/50"}`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider text-muted">
                <Upload size={24} />
              </div>
              {file ? (
                <p className="font-semibold text-primary">
                  {file.name}
                  <span className="ml-2 font-normal text-muted">({rows.length} rows found)</span>
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Drag and drop your CSV file here<br />
                  <span className="text-subtle">or</span>
                </p>
              )}
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <p className="text-xs text-subtle">CSV or Excel (.csv, .xlsx, .xls), max 5 MB</p>
            </div>


            <div className="flex justify-end">
              <button
                onClick={async () => {
                  if (!file || rows.length === 0) return;
                  setValidating(true);
                  try {
                    const payload = rows.map(r => ({
                      rowNum: r.rowNum,
                      name: r.name,
                      phone: r.phone,
                      email: r.email,
                      service: r.service,
                      payment: parseFloat(r.payment) || 0,
                      valid: r.valid,
                      ...(r.paidOn ? { paidOn: r.paidOn } : {}),
                    }));
                    const { results } = await api.post<{ results: { rowNum: number; errors: string[]; warnings: string[]; isDuplicate: boolean }[] }>(
                      "/api/v1/admin/validate-import",
                      { rows: payload }
                    );
                    setRows(prev => prev.map(r => {
                      const validation = results.find(v => v.rowNum === r.rowNum);
                      if (!validation) return r;
                      return {
                        ...r,
                        errors: validation.errors.length > 0 ? validation.errors : r.errors,
                        warnings: validation.warnings,
                        isDuplicate: validation.isDuplicate,
                      };
                    }));
                  } catch {
                    toast.error("Validation failed. Please try again.");
                  } finally {
                    setValidating(false);
                  }
                  setStep(2);
                }}
                disabled={!file || rows.length === 0 || validating}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                <CheckCircle size={15} />
                {validating ? "Validating…" : "Upload & Preview"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 2 && (
          <>
          {/* Validation Error Modal */}
          {showErrorModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-divider px-6 py-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={18} className="text-red-500" />
                    <h3 className="font-display text-base font-bold text-primary">Validation Issues</h3>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                      {errorRows.length} rows
                    </span>
                  </div>
                  <button onClick={() => setShowErrorModal(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-divider transition-colors">
                    <X size={16} className="text-muted" />
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-subtle">
                        <th className="pb-3 pr-4">Row</th>
                        <th className="pb-3 pr-4">Name</th>
                        <th className="pb-3">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errorRows.map((r) => (
                        <tr key={r.rowNum} className="border-t border-divider">
                          <td className="py-3 pr-4 font-mono text-subtle">{r.rowNum}</td>
                          <td className="py-3 pr-4 font-semibold text-primary">{r.name || "—"}</td>
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
                <div className="flex justify-end border-t border-divider px-6 py-4">
                  <button onClick={() => setShowErrorModal(false)}
                    className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105">
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-primary">
                Sample CSV Preview
                {rows.length > 0 && <span className="ml-2 text-sm font-normal text-muted">({rows.length} records)</span>}
              </h2>
              {errorRows.length > 0 && (
                <button onClick={() => setShowErrorModal(true)}
                  className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100">
                  <AlertTriangle size={14} />
                  {errorRows.length} validation issues
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-200 text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase text-subtle">
                    {["SR. NO", "NAME", "PHONE NUMBER", "PAYMENT", "PAID ON", "VALID", "SERVICE", "EMAIL"].map(h => (
                      <th key={h} className="px-3 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const hasError = r.errors.length > 0;
                    const hasWarning = !hasError && r.warnings.length > 0;

                    function EditableCell({ field, value, className }: { field: string; value: string; className?: string }) {
                      const isEditing = editCell?.rowNum === r.rowNum && editCell?.field === field;
                      if (isEditing) {
                        if (field === "service") {
                          return (
                            <select autoFocus value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              className="w-full rounded border border-accent px-2 py-1 text-xs focus:outline-none">
                              <option value="">Select community</option>
                              {communities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          );
                        }
                        return (
                          <input autoFocus value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full rounded border border-accent px-2 py-1 text-xs focus:outline-none" />
                        );
                      }
                      return (
                        <span className={`group flex cursor-pointer items-center gap-1 ${className ?? ""}`}
                          onClick={() => { setEditCell({ rowNum: r.rowNum, field }); setEditValue(value); }}>
                          {value || "—"}
                          <Pencil size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-40" />
                        </span>
                      );
                    }

                    return (
                      <tr key={i}
                        className={`border-t border-divider transition-colors ${hasError ? "bg-red-50/40" : hasWarning ? "bg-amber-50/60" : "hover:bg-background"}`}>
                        <td className="px-3 py-3 text-subtle">{(previewPage - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-3">
                          <EditableCell field="name" value={r.name}
                            className={`font-semibold ${hasError ? "text-red-600" : hasWarning ? "text-amber-700" : "text-primary"}`} />
                          {hasWarning && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">EXISTS</span>}
                        </td>
                        <td className="px-3 py-3 text-muted"><EditableCell field="phone" value={r.phone} /></td>
                        <td className="px-3 py-3 text-muted"><EditableCell field="payment" value={r.payment} /></td>
                        <td className="px-3 py-3 text-muted"><EditableCell field="paidOn" value={r.paidOn} /></td>
                        <td className="px-3 py-3 text-muted"><EditableCell field="valid" value={r.valid} /></td>
                        <td className="px-3 py-3">
                          <EditableCell field="service" value={r.service} />
                        </td>
                        <td className="px-3 py-3 text-muted"><EditableCell field="email" value={r.email} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={previewPage === 1}
                  className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">
                  Previous
                </button>
                <span className="text-sm text-muted">Page {previewPage} of {totalPages}</span>
                <button onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))} disabled={previewPage === totalPages}
                  className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40">
                  Next
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button onClick={() => { setStep(1); setRows([]); setFile(null); setNeedsRevalidation(false); }}
                className="rounded-full border border-divider px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-primary">
                Cancel
              </button>
              <div className="flex items-center gap-3">
                {needsRevalidation && (
                  <button onClick={revalidate} disabled={validating}
                    className="flex items-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/5 disabled:opacity-50">
                    <AlertTriangle size={14} />
                    {validating ? "Validating…" : "Re-validate"}
                  </button>
                )}
                <button onClick={handleConfirmImport} disabled={importing || validRows.length === 0 || needsRevalidation}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                  <CheckCircle size={15} />
                  {importing ? "Importing…" : "Confirm Import"}
                </button>
              </div>
            </div>
          </div>
          </>
        )}

        {/* ── Step 3: Success ── */}
        {step === 3 && result && (
          <div className="mt-12 flex flex-col items-center gap-4 pb-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-glow">
              <CheckCircle size={36} />
            </div>
            <h2 className="font-display text-2xl font-bold text-primary">Import Successful</h2>
            <div className="flex gap-6 text-sm">
              <span className="font-semibold text-accent">{result.created} added</span>
              <span className="font-semibold text-primary">{result.updated} updated</span>
              <span className="text-muted">{result.skipped} skipped</span>
              {result.errors.length > 0 && <span className="font-semibold text-red-500">{result.errors.length} errors</span>}
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 w-full max-w-lg rounded-xl border border-red-200 bg-red-50 p-4 text-left">
                <p className="mb-2 text-xs font-bold text-red-700">Rows with errors:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600">Row {e.row} ({e.phone}): {e.reason}</p>
                ))}
              </div>
            )}
            <button onClick={() => { setStep(1); setFile(null); setRows([]); setResult(null); }}
              className="mt-4 text-sm font-semibold text-accent transition-colors hover:text-primary">
              Import Another File →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
