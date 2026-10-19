"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CatalogService } from "@/lib/services";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

const BASE = "/api/v1/admin/services/catalog";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface FormState {
  name: string;
  title: string;
  description: string;
  imageUrl: string | null;
  isActive: boolean;
}

const EMPTY: FormState = { name: "", title: "", description: "", imageUrl: null, isActive: true };
const input = "mt-1.5 w-full rounded-xl border border-[#dcd9d0] bg-white px-3.5 py-2.5 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent";

function ServiceForm({ editing, onClose, onSaved }: { editing: CatalogService | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(
    editing ? { name: editing.name, title: editing.title, description: editing.description, imageUrl: editing.imageUrl, isActive: editing.isActive } : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("Use a JPG, PNG or WebP image.");
      return;
    }
    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await api.post<{ uploadUrl: string; publicUrl: string }>(`${BASE}/image/presign`, { fileName: file.name });
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error("upload failed");
      setForm((f) => ({ ...f, imageUrl: publicUrl }));
    } catch {
      toast.error("Couldn't upload the image. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = { name: form.name.trim(), title: form.title.trim(), description: form.description.trim(), imageUrl: form.imageUrl, isActive: form.isActive };
      if (editing) await api.patch(`${BASE}/${editing.id}`, body);
      else await api.post(BASE, body);
      toast.success(editing ? "Service updated" : "Service created");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0] ?? "Invalid"])));
      else toast.error(err instanceof ApiError ? err.message : "Couldn't save the service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit service" : "Add service"}>
      <form onSubmit={save} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-7 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-primary">{editing ? "Edit service" : "Add a service"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-divider hover:text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <label className="text-xs font-semibold text-muted">
            Title (shown to members)
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} placeholder="Portfolio Management" className={input} />
            {errors.title && <span className="mt-1 block text-[11px] text-red-500">{errors.title}</span>}
          </label>
          <label className="text-xs font-semibold text-muted">
            Name (internal, only admins see it)
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} placeholder="pms-monthly" className={input} />
            {errors.name && <span className="mt-1 block text-[11px] text-red-500">{errors.name}</span>}
          </label>
          <label className="text-xs font-semibold text-muted">
            Description
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} rows={5} placeholder="What the service includes, who it is for…" className={`${input} resize-none`} />
            {errors.description && <span className="mt-1 block text-[11px] text-red-500">{errors.description}</span>}
          </label>

          <div>
            <p className="text-xs font-semibold text-muted">Image</p>
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} className="hidden" onChange={pickImage} />
            {form.imageUrl ? (
              <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-divider p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="" className="h-16 w-16 rounded-lg bg-background object-cover" />
                <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-bold text-accent hover:underline">Replace</button>
                <button type="button" onClick={() => setForm({ ...form, imageUrl: null })} className="text-xs font-bold text-muted hover:text-primary">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-background px-4 py-5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-50"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                {uploading ? "Uploading…" : "Add image (JPG, PNG or WebP)"}
              </button>
            )}
            {errors.imageUrl && <span className="mt-1 block text-[11px] text-red-500">{errors.imageUrl}</span>}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 accent-primary" />
            Available to members
          </label>
        </div>

        <button
          type="submit"
          disabled={saving || uploading || !form.title.trim() || !form.name.trim() || !form.description.trim()}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-lime to-accent text-sm font-bold text-primary shadow-glow transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {editing ? "Save changes" : "Create service"}
        </button>
      </form>
    </div>
  );
}

export default function ServiceCatalogPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [services, setServices] = useState<CatalogService[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<CatalogService | "new" | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CatalogService[]>(BASE)
      .then((rows) => {
        if (cancelled) return;
        setServices(rows);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);

  async function toggleActive(s: CatalogService) {
    try {
      await api.patch(`${BASE}/${s.id}`, { isActive: !s.isActive });
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update the service.");
    }
  }

  async function remove(s: CatalogService) {
    const ok = await confirm({
      variant: "danger",
      title: "Delete service",
      message: (
        <>
          Delete <strong>{s.title}</strong>? Members can no longer request it. Requests already raised for it keep working.
        </>
      ),
      confirmLabel: "Delete",
      icon: <Trash2 size={22} />,
    });
    if (!ok) return;
    try {
      await api.delete(`${BASE}/${s.id}`);
      toast.success("Service deleted");
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete the service.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold text-accent">
            Dashboard <ChevronRight size={12} />
            <Link href="/admin/services" className="hover:underline">Services</Link> <ChevronRight size={12} /> Catalog
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-primary">Service catalog</h1>
          <p className="mt-1 text-sm text-muted">The services members can request. The price always comes from the quote you send.</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex h-11 items-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-6 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-105 active:scale-95"
        >
          <Plus size={15} /> Add service
        </button>
      </div>

      {services === null && !error ? (
        <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-sm font-semibold text-primary">Couldn&apos;t load the catalog</p>
          <button onClick={reload} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Retry</button>
        </div>
      ) : services!.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-white py-20 text-center shadow-card">
          <Briefcase size={28} className="text-subtle" />
          <p className="text-sm font-semibold text-primary">No services yet</p>
          <p className="text-xs text-muted">Add the first service members can request.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {services!.map((s) => (
            <article key={s.id} className={`flex flex-col overflow-hidden rounded-3xl bg-white shadow-card ${s.isActive ? "" : "opacity-70"}`}>
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" className="h-36 w-full bg-background object-cover" />
              ) : (
                <div className="flex h-36 w-full items-center justify-center bg-background text-subtle"><Briefcase size={28} /></div>
              )}
              <div className="flex flex-1 flex-col px-6 py-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-primary wrap-break-word">{s.title}</h2>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.isActive ? "bg-[#e4f7ea] text-[#16a34a]" : "bg-[#f1efe6] text-muted"}`}>{s.isActive ? "Active" : "Hidden"}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-subtle">{s.name}</p>
                <p className="mt-3 line-clamp-4 text-sm text-primary/80">{s.description}</p>
                <div className="mt-auto flex items-center gap-2 pt-5">
                  <button onClick={() => setEditing(s)} className="flex h-9 items-center gap-1.5 rounded-full border border-[#dcd9d0] px-4 text-xs font-bold text-primary transition-colors hover:border-accent">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => toggleActive(s)} className="h-9 rounded-full border border-[#dcd9d0] px-4 text-xs font-bold text-primary transition-colors hover:border-accent">
                    {s.isActive ? "Hide" : "Show"}
                  </button>
                  <button onClick={() => remove(s)} aria-label={`Delete ${s.title}`} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-[#fff0f2] hover:text-[#e11d48]">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <ServiceForm
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
