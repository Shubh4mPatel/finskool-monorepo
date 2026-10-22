"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import type { CatalogService } from "@/lib/services";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import ServicesTabs from "@/components/admin/services/ServicesTabs";
import ServiceCardBody from "@/components/admin/services/ServiceCard";

const BASE = "/api/v1/admin/services/catalog";

function ServiceCatalogManager() {
  const confirm = useConfirm();
  const toast = useToast();
  const [services, setServices] = useState<CatalogService[] | null>(null);
  const [error, setError] = useState(false);
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
          <h1 className="mt-1 font-display text-3xl font-bold text-primary">Services</h1>
          <p className="mt-1 text-sm text-muted">Manage the services members can enquire about.</p>
        </div>
        <Link
          href="/admin/services/catalog/new"
          className="flex h-11 items-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-6 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-105 active:scale-95"
        >
          <Plus size={15} /> Add service
        </Link>
      </div>

      <ServicesTabs active="catalog" />

      {services === null && !error ? (
        <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-sm font-semibold text-primary">Couldn&apos;t load the services</p>
          <button onClick={reload} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Retry</button>
        </div>
      ) : services!.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-white py-20 text-center shadow-card">
          <Briefcase size={28} className="text-subtle" />
          <p className="text-sm font-semibold text-primary">No services yet</p>
          <p className="text-xs text-muted">Add the first service members can enquire about.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {services!.map((s) => (
            <article key={s.id} className={`flex flex-col overflow-hidden rounded-3xl bg-white shadow-card ${s.isActive ? "" : "opacity-70"}`}>
              <ServiceCardBody service={s} />
              <div className="flex flex-1 flex-col px-5 pb-5">
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.openRequests > 0 && (
                    <span className="rounded-full bg-[#fff6dc] px-2.5 py-1 text-[11px] font-bold text-[#7a5200]">
                      {s.openRequests} open {s.openRequests === 1 ? "enquiry" : "enquiries"}
                    </span>
                  )}
                  {!s.isActive && <span className="rounded-full bg-[#f1efe6] px-2.5 py-1 text-[11px] font-bold text-muted">Hidden from members</span>}
                </div>
                <p className="mt-3 text-xs text-muted">
                  <strong className="text-primary">Pricing on request</strong> · quote per enquiry
                </p>
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <Link
                    href={`/admin/services?serviceId=${s.id}`}
                    className="flex h-9 items-center gap-1 whitespace-nowrap rounded-full border border-[#dcd9d0] px-4 text-xs font-bold text-primary transition-colors hover:border-accent"
                  >
                    View enquiries <ChevronRight size={12} />
                  </Link>
                  <button onClick={() => toggleActive(s)} className="h-9 rounded-full border border-[#dcd9d0] px-4 text-xs font-bold text-primary transition-colors hover:border-accent">
                    {s.isActive ? "Hide" : "Show"}
                  </button>
                  <Link
                    href={`/admin/services/catalog/${s.id}/edit`}
                    aria-label={`Edit ${s.title}`}
                    className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-background hover:text-primary"
                  >
                    <Pencil size={14} />
                  </Link>
                  <button onClick={() => remove(s)} aria-label={`Delete ${s.title}`} className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-[#fff0f2] hover:text-[#e11d48]">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ServiceCatalogPage() {
  const isSuperAdmin = useIsSuperAdmin();
  if (isSuperAdmin === null) return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm font-semibold text-primary">Only super admins can manage the service catalog.</p>
        <Link href="/admin/services" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to services</Link>
      </div>
    );
  }
  return <ServiceCatalogManager />;
}
