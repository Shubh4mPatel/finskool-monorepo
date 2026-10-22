"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ImagePlus, Info, Loader2, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { SERVICE_LIMITS } from "@/lib/services";
import type { CatalogService, QuoteDefaults, ServiceTypeOption } from "@/lib/services";
import { useToast } from "@/components/ui/Toast";
import MarkdownField from "@/components/admin/welcome-kit/MarkdownField";
import ServiceCardBody from "@/components/admin/services/ServiceCard";

const BASE = "/api/v1/admin/services/catalog";
const input = "mt-1.5 h-11 w-full rounded-xl border border-[#dcd9d0] bg-white px-3.5 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent";
const label = "text-xs font-semibold text-muted";

interface FormState {
  title: string;
  serviceType: string;
  description: string;
  imageUrl: string | null;
  iconUrl: string | null;
  tags: string[];
  highlights: string[];
  points: string[];
}

const EMPTY: FormState = { title: "", serviceType: "", description: "", imageUrl: null, iconUrl: null, tags: [], highlights: [], points: [] };

const fromService = (s: CatalogService): FormState => ({
  title: s.title,
  serviceType: s.serviceType?.key ?? "",
  description: s.description,
  imageUrl: s.imageUrl,
  iconUrl: s.iconUrl,
  tags: s.tags,
  highlights: s.highlights,
  points: s.whatMembersGet,
});

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white px-7 py-6 shadow-card">
      <div>
        <h2 className="font-display text-lg font-bold text-primary">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const FieldError = ({ message }: { message?: string | undefined }) => (message ? <span className="mt-1 block text-[11px] text-red-500">{message}</span> : null);

/** Uploads straight to storage through a presigned link (same flow as the community cover image). */
function ImagePicker({
  value,
  onChange,
  title,
  hint,
  className,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  title: string;
  hint: string;
  className: string;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Please choose an image under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await api.post<{ uploadUrl: string; publicUrl: string }>(`${BASE}/image/presign`, { fileName: file.name });
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("upload failed");
      onChange(publicUrl);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't upload the image. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      {value ? (
        <div className={`relative overflow-hidden rounded-2xl border border-[#dcd9d0] bg-background ${className}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={title} className="h-full w-full object-cover" />
          <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${title.toLowerCase()}`} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-primary shadow hover:bg-white">
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#c9c5b8] bg-background text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-60 ${className}`}
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}
          {uploading ? "Uploading…" : `Upload ${title.toLowerCase()}`}
          <span className="px-4 text-center text-[11px] font-normal text-subtle">{hint}</span>
        </button>
      )}
    </div>
  );
}

/** Type a value, press Enter or comma to add it as a chip. */
function ChipInput({
  values,
  onChange,
  max,
  placeholder,
  prefix = "",
  maxLength,
  splitOnComma = false,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder: string;
  prefix?: string;
  maxLength: number;
  /** Tags: a comma ends one tag. Off for free text that may contain commas ("Min ₹5,00,000"). */
  splitOnComma?: boolean;
}) {
  const [draft, setDraft] = useState("");

  /** Adds one or more values (with splitOnComma, a pasted "a, b, c" becomes three chips), skipping blanks and duplicates. */
  function commit(raw: string) {
    const parts = (splitOnComma ? raw.split(",") : [raw]).map((v) => v.trim().replace(/^#+/, "").trim()).filter(Boolean);
    setDraft("");
    if (parts.length === 0) return;
    const next = [...values];
    for (const v of parts) {
      if (next.length >= max) break;
      if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
    }
    if (next.length !== values.length) onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#dcd9d0] bg-white px-3 py-2 focus-within:border-accent">
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs font-bold text-primary">
          {prefix}{v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-muted hover:text-[#e11d48]">
            <X size={11} />
          </button>
        </span>
      ))}
      {values.length < max && (
        <input
          value={draft}
          maxLength={maxLength}
          onChange={(e) => (splitOnComma && e.target.value.includes(",") ? commit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-32 flex-1 bg-transparent py-1 text-sm text-primary outline-none placeholder:text-muted"
        />
      )}
    </div>
  );
}

export default function ServiceForm({ serviceId }: { serviceId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(serviceId);

  const [form, setForm] = useState<FormState | null>(editing ? null : EMPTY);
  const [original, setOriginal] = useState<CatalogService | null>(null);
  const [types, setTypes] = useState<ServiceTypeOption[]>([]);
  const [quoteDays, setQuoteDays] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<ServiceTypeOption[]>(`${BASE}/types`),
      api.get<QuoteDefaults>("/api/v1/admin/services/quote-defaults").catch(() => null),
      serviceId ? api.get<CatalogService>(`${BASE}/${serviceId}`) : Promise.resolve(null),
    ])
      .then(([t, q, s]) => {
        if (cancelled) return;
        setTypes(t);
        setQuoteDays(q ? q.defaultQuoteExpiryDays : null);
        if (s) {
          setOriginal(s);
          setForm(fromService(s));
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  if (loadError) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm font-semibold text-primary">Couldn&apos;t load this service</p>
        <Link href="/admin/services/catalog" className="mt-3 inline-block rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to services</Link>
      </div>
    );
  }
  if (!form) return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;

  // Editing a field clears its error straight away; the rest stay until the next Continue.
  const patch = (next: Partial<FormState>) => {
    setForm({ ...form, ...next });
    const touched = Object.keys(next).flatMap((k) => (k === "points" ? ["points", "whatMembersGet"] : [k]));
    if (touched.some((k) => errors[k])) setErrors(Object.fromEntries(Object.entries(errors).filter(([k]) => !touched.includes(k))));
  };
  const typeLabel = types.find((t) => t.key === form.serviceType)?.label;

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form!.title.trim()) e.title = "Enter the service name";
    if (!form!.serviceType) e.serviceType = "Choose a service type";
    if (!form!.description.trim()) e.description = "Add a description";
    if (form!.points.some((p) => !p.trim())) e.points = "Fill in or remove the empty points";
    return e;
  }

  function next() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  async function save() {
    const e = validate();
    if (Object.keys(e).length > 0) {
      setErrors(e);
      setStep(1);
      return;
    }
    setSaving(true);
    const body = {
      title: form!.title.trim(),
      description: form!.description.trim(),
      serviceType: form!.serviceType,
      imageUrl: form!.imageUrl,
      iconUrl: form!.iconUrl,
      tags: form!.tags,
      highlights: form!.highlights,
      whatMembersGet: form!.points.map((p) => p.trim()),
    };
    try {
      if (serviceId) await api.patch(`${BASE}/${serviceId}`, body);
      else await api.post(BASE, body);
      toast.success(serviceId ? "Service updated" : "Service published");
      router.push("/admin/services/catalog");
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k.split(".")[0] ?? k, v[0] ?? "Invalid"])));
        setStep(1);
      } else toast.error(err instanceof ApiError ? err.message : "Couldn't save the service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const steps = [
    { n: 1, name: "Service details" },
    { n: 2, name: "Review & publish" },
  ] as const;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="flex items-center gap-1 text-xs font-semibold text-accent">
          Admin panel <ChevronRight size={12} />
          <Link href="/admin/services/catalog" className="hover:underline">Services</Link> <ChevronRight size={12} /> {editing ? "Edit service" : "Add service"}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-primary">{editing ? "Edit service" : "Add service"}</h1>
        <p className="mt-1 text-sm text-muted">{editing ? "Change what members see for this service." : "Set up a new service members can enquire about."}</p>
      </div>

      <ol className="flex items-center gap-3 rounded-3xl bg-white px-7 py-4 shadow-card">
        {steps.map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step > s.n ? "bg-lime text-primary" : step === s.n ? "bg-primary text-white" : "bg-background text-muted"}`}>
              {step > s.n ? <Check size={15} /> : s.n}
            </span>
            <span className={`text-sm font-bold ${step >= s.n ? "text-primary" : "text-muted"}`}>{s.name}</span>
            {i === 0 && <span className="h-px flex-1 bg-[#dcd9d0]" />}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <>
          <Section title="Thumbnail image" hint="Shown at the top of the service card. JPG, PNG or WebP, under 5 MB.">
            <ImagePicker value={form.imageUrl} onChange={(imageUrl) => patch({ imageUrl })} title="Thumbnail image" hint="Recommended 1200 × 675 px (16:9)" className="h-52 w-full" />
            <div className="flex items-center gap-4">
              <ImagePicker value={form.iconUrl} onChange={(iconUrl) => patch({ iconUrl })} title="Icon" hint="Square, 256 × 256 px" className="h-24 w-24 shrink-0" />
              <p className="text-xs text-muted">A small square icon shown next to the service name. Optional.</p>
            </div>
          </Section>

          <Section title="Service details">
            <label className={label}>
              Service name
              <input value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} placeholder="e.g. Portfolio Analysis" className={input} />
              <FieldError message={errors.title} />
            </label>
            <label className={label}>
              Service type
              <select value={form.serviceType} onChange={(e) => patch({ serviceType: e.target.value })} className={input}>
                <option value="">Choose a type…</option>
                {types.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <FieldError message={errors.serviceType} />
            </label>
            <div>
              <span className={label}>Description</span>
              <div className="mt-1.5">
                <MarkdownField value={form.description} onChange={(description) => patch({ description })} placeholder="Describe the service. Use bold for key terms." />
              </div>
              <div className="mt-1 flex justify-between">
                <FieldError message={errors.description} />
                <span className="ml-auto text-[11px] text-subtle">{form.description.length} / 5000</span>
              </div>
            </div>
            <div>
              <span className={label}>Tags</span>
              <div className="mt-1.5">
                <ChipInput values={form.tags} onChange={(tags) => patch({ tags })} max={SERVICE_LIMITS.tags} maxLength={30} prefix="#" placeholder="Type a tag and press Enter" splitOnComma />
              </div>
              <FieldError message={errors.tags} />
              <p className="mt-1 text-[11px] text-subtle">{form.tags.length} / {SERVICE_LIMITS.tags} tags</p>
            </div>
            <div>
              <span className={label}>Card highlights</span>
              <div className="mt-1.5">
                <ChipInput values={form.highlights} onChange={(highlights) => patch({ highlights })} max={SERVICE_LIMITS.highlights} maxLength={40} placeholder="e.g. Min ₹5,00,000 · 2% per transaction" />
              </div>
              <FieldError message={errors.highlights} />
              <p className="mt-1 text-[11px] text-subtle">Short key facts shown as chips on the card. Up to {SERVICE_LIMITS.highlights}.</p>
            </div>
          </Section>

          <Section title="What members get" hint={`Short points about what a member gets with this service, in the order they are shown. Up to ${SERVICE_LIMITS.points}.`}>
            <ul className="flex flex-col gap-2">
              {form.points.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime/60 text-primary"><Check size={13} /></span>
                  <input
                    value={p}
                    maxLength={150}
                    onChange={(e) => patch({ points: form.points.map((x, j) => (j === i ? e.target.value : x)) })}
                    placeholder="e.g. 1 year of support with a follow-up review"
                    className="h-10 flex-1 rounded-xl border border-[#dcd9d0] bg-white px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-accent"
                  />
                  <button type="button" disabled={i === 0} onClick={() => { const a = [...form.points]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; patch({ points: a }); }} aria-label="Move up" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button type="button" disabled={i === form.points.length - 1} onClick={() => { const a = [...form.points]; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; patch({ points: a }); }} aria-label="Move down" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary disabled:opacity-30"><ArrowDown size={14} /></button>
                  <button type="button" onClick={() => patch({ points: form.points.filter((_, j) => j !== i) })} aria-label="Remove point" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-[#fff0f2] hover:text-[#e11d48]"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
            <FieldError message={errors.whatMembersGet ?? errors.points} />
            <button
              type="button"
              disabled={form.points.length >= SERVICE_LIMITS.points}
              onClick={() => patch({ points: [...form.points, ""] })}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-[#c9c5b8] text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
            >
              <Plus size={14} /> Add point
            </button>
            <p className="text-right text-[11px] text-subtle">{form.points.length} / {SERVICE_LIMITS.points} points</p>
          </Section>

          <Section title="Pricing & enquiry" hint="How members pay for this service.">
            <div className="rounded-2xl border-2 border-accent bg-[#f3fbf7] px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-bold text-primary">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-accent"><span className="h-2 w-2 rounded-full bg-accent" /></span>
                Price on request
              </p>
              <p className="mt-1 pl-6 text-xs text-muted">Members send an enquiry first. You agree the scope in chat and send a quote, and they pay through it.</p>
            </div>
            <p className="flex items-start gap-2 rounded-xl bg-background px-4 py-3 text-xs text-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              A quote you send is valid for {quoteDays ?? 5} days by default. You can change that for each quote, and the default under Billing settings.
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section title="How it looks to members" hint="Check the card and the details, then publish.">
            <div className="max-w-sm overflow-hidden rounded-3xl bg-white pb-5 shadow-card ring-1 ring-black/5">
              <ServiceCardBody service={{ title: form.title, description: form.description, imageUrl: form.imageUrl, iconUrl: form.iconUrl, serviceType: typeLabel ? { key: form.serviceType, label: typeLabel } : null, highlights: form.highlights }} />
              <p className="px-5 pt-3 text-xs text-muted"><strong className="text-primary">Pricing on request</strong> · quote per enquiry</p>
            </div>
          </Section>
          <Section title="Details page">
            <div className="text-[15px] leading-relaxed text-[#1d2b27] [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_strong]:font-bold [&_ul]:list-disc">
              <ReactMarkdown>{form.description}</ReactMarkdown>
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.tags.map((t) => <span key={t} className="rounded-full bg-background px-2.5 py-1 text-xs font-bold text-primary">#{t}</span>)}
              </div>
            )}
            {form.points.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-primary">What you get</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {form.points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-primary">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime/60"><Check size={11} /></span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
          {editing && original && !original.isActive && (
            <p className="rounded-xl bg-[#fff6dc] px-4 py-3 text-xs text-[#7a5200]">This service is hidden from members. Use Show on the services page to make it visible again.</p>
          )}
        </>
      )}

      <div className="flex items-center justify-center gap-3 pb-6">
        {step === 1 ? (
          <>
            <Link href="/admin/services/catalog" className="flex h-12 items-center rounded-full border border-[#dcd9d0] bg-white px-8 text-sm font-bold text-primary hover:border-accent">Cancel</Link>
            <button type="button" onClick={next} className="flex h-12 items-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-10 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-[1.02] active:scale-95">
              Continue <ChevronRight size={15} />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep(1)} disabled={saving} className="flex h-12 items-center gap-1 rounded-full border border-[#dcd9d0] bg-white px-8 text-sm font-bold text-primary hover:border-accent disabled:opacity-50">
              <ChevronLeft size={15} /> Back
            </button>
            <button type="button" onClick={save} disabled={saving} className="flex h-12 items-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-10 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "Save changes" : "Publish service"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
