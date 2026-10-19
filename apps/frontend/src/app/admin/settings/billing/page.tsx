"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Info, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import type { BillingSettings, GstState } from "@/lib/services";
import { useToast } from "@/components/ui/Toast";

const BASE = "/api/v1/admin/services";
const input = "mt-1.5 h-11 w-full rounded-xl border border-[#dcd9d0] bg-white px-3.5 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent";

interface FormState {
  legalName: string;
  addressLine: string;
  city: string;
  pincode: string;
  stateCode: string;
  gstin: string;
  sacCode: string;
  contactEmail: string;
  contactPhone: string;
  footerNote: string;
  defaultGstRatePercent: string;
  defaultQuoteExpiryDays: string;
  invoicePrefix: string;
}

const fromSettings = (s: BillingSettings): FormState => ({
  legalName: s.legalName ?? "",
  addressLine: s.addressLine ?? "",
  city: s.city ?? "",
  pincode: s.pincode ?? "",
  stateCode: s.stateCode ?? "",
  gstin: s.gstin ?? "",
  sacCode: s.sacCode ?? "",
  contactEmail: s.contactEmail ?? "",
  contactPhone: s.contactPhone ?? "",
  footerNote: s.footerNote ?? "",
  defaultGstRatePercent: String(s.defaultGstRatePercent),
  defaultQuoteExpiryDays: String(s.defaultQuoteExpiryDays),
  invoicePrefix: s.invoicePrefix,
});

/** Indian financial year (April to March, IST) as "2026-27", for the invoice number preview. */
function currentFinancialYear(): string {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export default function BillingSettingsPage() {
  const toast = useToast();
  const isSuperAdmin = useIsSuperAdmin();

  const [form, setForm] = useState<FormState | null>(null);
  const [configured, setConfigured] = useState(false);
  const [states, setStates] = useState<GstState[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    Promise.all([api.get<BillingSettings>(`${BASE}/billing-settings`), api.get<GstState[]>(`${BASE}/gst-states`)])
      .then(([settings, list]) => {
        if (cancelled) return;
        setForm(fromSettings(settings));
        setConfigured(settings.isConfigured);
        setStates(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  if (isSuperAdmin === null) return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm font-semibold text-primary">Only super admins can change billing settings.</p>
        <Link href="/admin/services" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to services</Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm font-semibold text-primary">Couldn&apos;t load the billing settings</p>
        <button onClick={() => window.location.reload()} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Retry</button>
      </div>
    );
  }

  if (!form) return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  const err = (key: string) => errors[key] && <span className="mt-1 block text-[11px] text-red-500">{errors[key]}</span>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setErrors({});
    const optional = (v: string) => (v.trim() ? { value: v.trim() } : null);
    try {
      const body = {
        legalName: form.legalName.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        pincode: form.pincode.trim(),
        stateCode: form.stateCode,
        gstin: form.gstin.trim().toUpperCase(),
        sacCode: form.sacCode.trim(),
        ...(optional(form.contactEmail) ? { contactEmail: form.contactEmail.trim() } : {}),
        ...(optional(form.contactPhone) ? { contactPhone: form.contactPhone.trim() } : {}),
        ...(optional(form.footerNote) ? { footerNote: form.footerNote.trim() } : {}),
        defaultGstRatePercent: Number(form.defaultGstRatePercent),
        defaultQuoteExpiryDays: Number(form.defaultQuoteExpiryDays),
        invoicePrefix: form.invoicePrefix.trim().toUpperCase(),
      };
      const saved = await api.put<BillingSettings>(`${BASE}/billing-settings`, body);
      setForm(fromSettings(saved));
      setConfigured(saved.isConfigured);
      toast.success("Billing settings saved");
    } catch (error) {
      if (error instanceof ApiError && error.errors) setErrors(Object.fromEntries(Object.entries(error.errors).map(([k, v]) => [k, v[0] ?? "Invalid"])));
      else toast.error(error instanceof ApiError ? error.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="flex items-center gap-1 text-xs font-semibold text-accent">
          Dashboard <ChevronRight size={12} />
          <Link href="/admin/services" className="hover:underline">Services</Link> <ChevronRight size={12} /> Billing settings
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-primary">Billing settings</h1>
        <p className="mt-1 text-sm text-muted">The business details printed on every GST invoice, and the defaults for new quotes.</p>
      </div>

      {configured ? (
        <div className="flex items-center gap-3 rounded-2xl bg-[#e4f7ea] px-5 py-3 text-sm text-[#166534]">
          <CheckCircle2 size={18} /> Billing is set up — admins can send quotes and invoices are issued automatically after payment.
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl bg-[#fff6dc] px-5 py-3 text-sm text-[#7a5200]">
          <Info size={18} className="mt-0.5 shrink-0" /> Admins can&apos;t send quotes until the business details below are saved.
        </div>
      )}

      <form onSubmit={save} className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-3xl bg-white px-7 py-6 shadow-card">
          <h2 className="font-display text-lg font-bold text-primary">Business details (on the invoice)</h2>
          <label className="text-xs font-semibold text-muted">
            Legal name
            <input value={form.legalName} onChange={set("legalName")} maxLength={200} className={input} />
            {err("legalName")}
          </label>
          <label className="text-xs font-semibold text-muted">
            Address
            <input value={form.addressLine} onChange={set("addressLine")} maxLength={300} className={input} />
            {err("addressLine")}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-muted">
              City
              <input value={form.city} onChange={set("city")} maxLength={100} className={input} />
              {err("city")}
            </label>
            <label className="text-xs font-semibold text-muted">
              Pincode
              <input value={form.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} className={input} />
              {err("pincode")}
            </label>
          </div>
          <label className="text-xs font-semibold text-muted">
            State (decides CGST + SGST or IGST)
            <select value={form.stateCode} onChange={set("stateCode")} className={input}>
              <option value="">Choose a state…</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </select>
            {err("stateCode")}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-muted">
              GSTIN
              <input value={form.gstin} onChange={set("gstin")} maxLength={15} placeholder="27AAAAA0000A1Z5" className={`${input} uppercase`} />
              {err("gstin")}
            </label>
            <label className="text-xs font-semibold text-muted">
              SAC code
              <input value={form.sacCode} onChange={set("sacCode")} inputMode="numeric" maxLength={8} placeholder="from your accountant" className={input} />
              {err("sacCode")}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-muted">
              Contact email (optional)
              <input value={form.contactEmail} onChange={set("contactEmail")} className={input} />
              {err("contactEmail")}
            </label>
            <label className="text-xs font-semibold text-muted">
              Contact phone (optional)
              <input value={form.contactPhone} onChange={set("contactPhone")} className={input} />
              {err("contactPhone")}
            </label>
          </div>
          <label className="text-xs font-semibold text-muted">
            Footer note (optional)
            <textarea value={form.footerNote} onChange={set("footerNote")} maxLength={500} rows={3} className="mt-1.5 w-full resize-none rounded-xl border border-[#dcd9d0] bg-white px-3.5 py-3 text-sm text-primary outline-none transition-colors focus:border-accent" />
            {err("footerNote")}
          </label>
        </section>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-4 rounded-3xl bg-white px-7 py-6 shadow-card">
            <h2 className="font-display text-lg font-bold text-primary">Quote defaults</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-muted">
                GST rate (%)
                <input value={form.defaultGstRatePercent} onChange={set("defaultGstRatePercent")} inputMode="decimal" className={input} />
                {err("defaultGstRatePercent")}
              </label>
              <label className="text-xs font-semibold text-muted">
                Quote valid for (days)
                <input value={form.defaultQuoteExpiryDays} onChange={set("defaultQuoteExpiryDays")} inputMode="numeric" className={input} />
                {err("defaultQuoteExpiryDays")}
              </label>
            </div>
            <p className="text-[11px] text-muted">Admins can change both for an individual quote when they send it.</p>
          </section>

          <section className="flex flex-col gap-4 rounded-3xl bg-white px-7 py-6 shadow-card">
            <h2 className="font-display text-lg font-bold text-primary">Invoice numbers</h2>
            <label className="text-xs font-semibold text-muted">
              Prefix
              <input value={form.invoicePrefix} onChange={set("invoicePrefix")} maxLength={10} className={`${input} uppercase`} />
              {err("invoicePrefix")}
            </label>
            <p className="text-[11px] text-muted">
              Numbers are issued automatically, one after another with no gaps, restarting each financial year (April to March). This
              year&apos;s first invoice is <strong className="text-primary">{(form.invoicePrefix || "FS").toUpperCase()}/{currentFinancialYear()}/0001</strong>.
              Changing the prefix does not alter invoices already issued.
            </p>
          </section>

          <button
            type="submit"
            disabled={saving}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-linear-to-r from-lime to-accent text-sm font-bold text-primary shadow-glow transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save billing settings
          </button>
        </div>
      </form>
    </div>
  );
}
