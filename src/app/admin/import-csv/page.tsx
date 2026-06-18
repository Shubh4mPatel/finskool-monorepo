"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle, Download, Upload } from "lucide-react";

type Step = 1 | 2 | 3;

const previewRows = [
  { name: "Sandeep", phone: "9898060907", payment: "4000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Swing Alpha", email: "ram@12example.com" },
  { name: "Ram Sharma", phone: "9898060907", payment: "2000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Investor", email: "ram@12example.com" },
  { name: "Jai Shah", phone: "9898060907", payment: "7000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Swing Alpha", email: "ram@12example.com" },
  { name: "Sandeep", phone: "9898060907", payment: "9000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Swing Alpha", email: "ram@12example.com" },
  { name: "Mandeep", phone: "9898060907", payment: "1000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Investor", email: "ram@12example.com" },
  { name: "Dev", phone: "9898060907", payment: "4000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", service: "Swing Alpha", email: "ram@12example.com" },
];

const steps = ["Upload File", "Preview & Review", "Confirm Import"];

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const n = (i + 1) as Step;
        const done = current > n;
        const active = current === n;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${done ? "bg-primary text-white" : active ? "bg-primary text-white ring-4 ring-primary/20" : "bg-divider text-subtle"}`}>
                {n}
              </div>
              <span className={`hidden text-sm font-semibold sm:block ${active ? "text-primary" : "text-subtle"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <div className={`mx-3 h-px w-12 sm:w-24 ${current > n ? "bg-primary" : "bg-divider"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function ImportCSVPage() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Import CSV</p>
        <h1 className="font-display text-2xl font-bold text-primary">Import Members</h1>
        <p className="mt-1 text-sm text-muted">Upload a CSV file to add or update members in bulk.</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <StepBar current={step} />

        {step === 1 && (
          <div className="mt-8 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-primary">Upload CSV File</h2>
              <button className="flex items-center gap-2 rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent transition-all hover:bg-accent/5">
                <Download size={14} />
                Download Sample CSV
              </button>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
              className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-colors ${dragging ? "border-accent bg-accent/5" : "border-divider bg-background"}`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider text-muted">
                <Upload size={24} />
              </div>
              {file ? (
                <p className="font-semibold text-primary">{file.name}</p>
              ) : (
                <p className="text-sm text-muted">Drag and drop your CSV file here<br /><span className="text-subtle">or</span></p>
              )}
              <label className="cursor-pointer rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">
                Browse File
                <input type="file" accept=".csv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <p className="text-xs text-subtle">CSV file only, max 50MB</p>
            </div>

            <div className="rounded-2xl border border-divider p-5">
              <h3 className="text-sm font-bold text-primary">CSV Format Guide</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="text-xs font-semibold uppercase text-subtle">
                      {["Sr. No", "Name", "Phone Number", "Payment", "Paid On", "Valid", "Community", "Email"].map((h) => (
                        <th key={h} className="px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-divider">
                      <td className="px-3 py-2 text-subtle">1</td>
                      <td className="px-3 py-2">Sandeep</td>
                      <td className="px-3 py-2">9898060907</td>
                      <td className="px-3 py-2">4000</td>
                      <td className="px-3 py-2">15 Aug 2026</td>
                      <td className="px-3 py-2">15 Aug 2026</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-lime/40 px-2 py-0.5 text-xs font-bold text-primary">Swing Alpha</span></td>
                      <td className="px-3 py-2 text-muted">ram@12example.com</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
              >
                Upload & Preview <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 flex flex-col gap-5">
            <h2 className="font-display text-base font-bold text-primary">Sample CSV Preview</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase text-subtle">
                    {["Sr. No", "Name", "Phone Number", "Payment", "Paid On", "Valid", "Service", "Email"].map((h) => (
                      <th key={h} className="px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} className="border-t border-divider transition-colors hover:bg-background">
                      <td className="px-3 py-3 text-subtle">{i + 1}</td>
                      <td className="px-3 py-3 font-semibold text-primary">{r.name}</td>
                      <td className="px-3 py-3 text-muted">{r.phone}</td>
                      <td className="px-3 py-3 text-muted">{r.payment}</td>
                      <td className="px-3 py-3 text-muted">{r.paidOn}</td>
                      <td className="px-3 py-3 text-muted">{r.valid}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.service === "Swing Alpha" ? "bg-lime/40 text-primary" : "bg-accent/10 text-accent"}`}>
                          {r.service}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => setStep(1)} className="rounded-full border border-divider px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-primary">Cancel</button>
              <button onClick={() => setStep(3)} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">
                <CheckCircle size={15} /> Confirm Import
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-12 flex flex-col items-center gap-4 pb-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-lime to-accent text-white shadow-glow">
              <CheckCircle size={36} />
            </div>
            <h2 className="font-display text-2xl font-bold text-primary">Import Successful</h2>
            <p className="text-sm text-muted">248 new members added · 12 updated · 2 rows skipped</p>
            <button onClick={() => setStep(1)} className="mt-4 text-sm font-semibold text-accent transition-colors hover:text-primary">
              Back To List →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
