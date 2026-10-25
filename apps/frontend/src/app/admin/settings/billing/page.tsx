"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Hash, Info, Loader2, Lock, Percent, RotateCcw, SearchX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import type { BillingSettings, GstState } from "@/lib/services";
import { useToast } from "@/components/ui/Toast";
import Select from "@/components/ui/Select";
import { EmptyState, Skeleton } from "@/components/admin/dashboard/Panel";
import { inputCls } from "@/components/admin/members/memberUi";

const BASE = "/api/v1/admin/services";

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

/** A labelled form row: the label is tied to its control, and an error shows (in red) beneath it. */
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-primary">
        {label}
      </label>
      {hint && <span className="ml-1.5 text-[11px] font-medium text-subtle">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] font-medium text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

/** An input with a fixed unit shown inside its right edge ("%", "days"). */
function UnitInput({ unit, className, ...props }: { unit: string; className: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input {...props} className={`${className} pr-14`} />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-subtle">{unit}</span>
    </div>
  );
}

function Card({ icon, title, subtitle, delay, children }: { icon: ReactNode; title: string; subtitle: string; delay: number; children: ReactNode }) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` }}
      className="animate-enter flex flex-col rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]"
    >
      <header className="flex items-center gap-3 border-b border-divider px-6 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">{icon}</span>
        <div>
          <h2 className="font-display text-[15px] font-bold tracking-tight text-primary">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </header>
      <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
    </section>
  );
}

export default function BillingSettingsPage() {
  const toast = useToast();
  const isSuperAdmin = useIsSuperAdmin();

  const [form, setForm] = useState<FormState | null>(null);
  // What was last loaded or saved — compared against `form` to spot unsaved edits.
  const [saved, setSaved] = useState<FormState | null>(null);
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
        setSaved(fromSettings(settings));
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

  const dirty = form !== null && saved !== null && JSON.stringify(form) !== JSON.stringify(saved);

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  if (isSuperAdmin === null) {
    return (
      <div className="flex max-w-5xl flex-col gap-5">
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex max-w-xl flex-col rounded-2xl bg-white shadow-card">
        <EmptyState icon={<Lock size={20} />}>Only super admins can change billing settings.</EmptyState>
        <Link href="/admin/services" className="mb-8 self-center rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]">
          Back to services
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex max-w-xl flex-col rounded-2xl bg-white shadow-card">
        <EmptyState icon={<SearchX size={20} />}>Couldn&apos;t load the billing settings.</EmptyState>
        <button onClick={() => window.location.reload()} className="mb-8 self-center rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]">
          Retry
        </button>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex max-w-5xl flex-col gap-5">
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  const fid = (k: keyof FormState) => `billing-${k}`;
  const cls = (k: keyof FormState) => inputCls(errors[k]);

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
      const result = await api.put<BillingSettings>(`${BASE}/billing-settings`, body);
      setForm(fromSettings(result));
      setSaved(fromSettings(result));
      setConfigured(result.isConfigured);
      toast.success("Billing settings saved");
    } catch (error) {
      if (error instanceof ApiError && error.errors) setErrors(Object.fromEntries(Object.entries(error.errors).map(([k, v]) => [k, v[0] ?? "Invalid"])));
      else toast.error(error instanceof ApiError ? error.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-5xl flex-col gap-6">
      <div className="animate-enter">
        <p className="text-xs font-semibold text-accent">
          Dashboard &rsaquo; <Link href="/admin/services" className="hover:underline">Services</Link> &rsaquo; Billing settings
        </p>
        <h1 className="font-display text-2xl font-bold text-primary">Billing settings</h1>
        <p className="mt-1 text-sm text-muted">The business details printed on every GST invoice, and the defaults for new quotes.</p>
      </div>

      {configured ? (
        <div className="animate-fade flex items-center gap-3 rounded-2xl bg-lime/30 px-5 py-3.5 text-sm font-medium text-primary">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lime text-primary">
            <CheckCircle2 size={18} />
          </span>
          Billing is set up — admins can send quotes, and invoices are issued automatically after payment.
        </div>
      ) : (
        <div role="status" className="animate-fade flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-3.5 text-sm font-medium text-amber-900">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Info size={18} />
          </span>
          <span className="pt-1.5">Admins can&apos;t send quotes until the business details below are saved.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card icon={<Building2 size={18} />} title="Business details" subtitle="Printed on every invoice" delay={60}>
          <Field id={fid("legalName")} label="Legal name" error={errors["legalName"]}>
            <input id={fid("legalName")} value={form.legalName} onChange={set("legalName")} maxLength={200} className={cls("legalName")} />
          </Field>
          <Field id={fid("addressLine")} label="Address" error={errors["addressLine"]}>
            <input id={fid("addressLine")} value={form.addressLine} onChange={set("addressLine")} maxLength={300} className={cls("addressLine")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid("city")} label="City" error={errors["city"]}>
              <input id={fid("city")} value={form.city} onChange={set("city")} maxLength={100} className={cls("city")} />
            </Field>
            <Field id={fid("pincode")} label="Pincode" error={errors["pincode"]}>
              <input id={fid("pincode")} value={form.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} className={`${cls("pincode")} tabular-nums`} />
            </Field>
          </div>
          <Field id={fid("stateCode")} label="State" hint="decides CGST + SGST or IGST" error={errors["stateCode"]}>
            <Select
              value={form.stateCode}
              onChange={(stateCode) => setForm({ ...form, stateCode })}
              placeholder="Choose a state…"
              ariaLabel="State"
              className="w-full"
              triggerClassName={`relative flex w-full items-center gap-2 text-left ${cls("stateCode")}`}
              options={states.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid("gstin")} label="GSTIN" error={errors["gstin"]}>
              <input id={fid("gstin")} value={form.gstin} onChange={set("gstin")} maxLength={15} placeholder="27AAAAA0000A1Z5" className={`${cls("gstin")} uppercase tabular-nums`} />
            </Field>
            <Field id={fid("sacCode")} label="SAC code" error={errors["sacCode"]}>
              <input id={fid("sacCode")} value={form.sacCode} onChange={set("sacCode")} inputMode="numeric" maxLength={8} placeholder="from your accountant" className={cls("sacCode")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid("contactEmail")} label="Contact email" hint="optional" error={errors["contactEmail"]}>
              <input id={fid("contactEmail")} type="email" value={form.contactEmail} onChange={set("contactEmail")} className={cls("contactEmail")} />
            </Field>
            <Field id={fid("contactPhone")} label="Contact phone" hint="optional" error={errors["contactPhone"]}>
              <input id={fid("contactPhone")} value={form.contactPhone} onChange={set("contactPhone")} className={cls("contactPhone")} />
            </Field>
          </div>
          <Field id={fid("footerNote")} label="Footer note" hint="optional" error={errors["footerNote"]}>
            <textarea id={fid("footerNote")} value={form.footerNote} onChange={set("footerNote")} maxLength={500} rows={3} className={`${cls("footerNote")} resize-none`} />
            <span className="mt-1 block text-right text-[11px] tabular-nums text-subtle">{form.footerNote.length}/500</span>
          </Field>
        </Card>

        <div className="flex flex-col gap-5">
          <Card icon={<Percent size={18} />} title="Quote defaults" subtitle="Applied to every new quote" delay={120}>
            <div className="grid grid-cols-2 gap-3">
              <Field id={fid("defaultGstRatePercent")} label="GST rate" error={errors["defaultGstRatePercent"]}>
                <UnitInput unit="%" id={fid("defaultGstRatePercent")} value={form.defaultGstRatePercent} onChange={set("defaultGstRatePercent")} inputMode="decimal" className={`${cls("defaultGstRatePercent")} tabular-nums`} />
              </Field>
              <Field id={fid("defaultQuoteExpiryDays")} label="Quote valid for" error={errors["defaultQuoteExpiryDays"]}>
                <UnitInput unit="days" id={fid("defaultQuoteExpiryDays")} value={form.defaultQuoteExpiryDays} onChange={set("defaultQuoteExpiryDays")} inputMode="numeric" className={`${cls("defaultQuoteExpiryDays")} tabular-nums`} />
              </Field>
            </div>
            <p className="rounded-xl bg-background px-3.5 py-2.5 text-xs text-muted">Admins can change both for an individual quote when they send it.</p>
          </Card>

          <Card icon={<Hash size={18} />} title="Invoice numbers" subtitle="Issued automatically, with no gaps" delay={180}>
            <Field id={fid("invoicePrefix")} label="Prefix" error={errors["invoicePrefix"]}>
              <input id={fid("invoicePrefix")} value={form.invoicePrefix} onChange={set("invoicePrefix")} maxLength={10} className={`${cls("invoicePrefix")} uppercase`} />
            </Field>
            <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Your first invoice this year</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-primary">
                {(form.invoicePrefix || "FS").toUpperCase()}/{currentFinancialYear()}/0001
              </p>
            </div>
            <p className="text-xs text-muted">
              Numbers restart each financial year (April to March). Changing the prefix does not alter invoices already issued.
            </p>
          </Card>
        </div>
      </div>

      {/* Sticky action bar — always in reach at the bottom of the form */}
      <div className="sticky bottom-0 z-20 -mx-1 bg-background/85 px-1 pb-4 pt-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card-hover ring-1 ring-primary/[0.04]">
          <p className="text-xs font-semibold text-muted" aria-live="polite">
            {dirty ? (
              <span className="animate-fade inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-600" /> All changes saved
              </span>
            )}
          </p>
          <div className="flex items-center gap-2.5">
            {dirty && (
              <button
                type="button"
                onClick={() => { setForm(saved); setErrors({}); }}
                disabled={saving}
                className="animate-fade flex items-center gap-1.5 rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
              >
                <RotateCcw size={14} /> Discard
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !dirty}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving…" : "Save billing settings"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
