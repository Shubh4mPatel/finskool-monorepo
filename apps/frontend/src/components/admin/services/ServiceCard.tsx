"use client";

import { Briefcase } from "lucide-react";
import type { CatalogService } from "@/lib/services";

/** Markdown to a one-line plain excerpt for the card (the full text is rendered on the detail view). */
export function plainExcerpt(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The card members see in the app, drawn the same way in the catalog list and in the publish preview. */
export default function ServiceCardBody({
  service,
}: {
  service: Pick<CatalogService, "title" | "description" | "imageUrl" | "iconUrl" | "serviceType" | "highlights">;
}) {
  return (
    <>
      <div className="relative">
        {service.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.imageUrl} alt="" className="h-44 w-full bg-background object-cover" />
        ) : (
          <div className="flex h-44 w-full items-center justify-center bg-background text-subtle"><Briefcase size={30} /></div>
        )}
        {service.iconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.iconUrl} alt="" className="absolute right-3 top-3 h-9 w-9 rounded-xl border border-white bg-white object-cover shadow" />
        )}
        {service.highlights.length > 0 && (
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
            {service.highlights.map((h) => (
              <span key={h} className="rounded-full bg-primary/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{h}</span>
            ))}
          </div>
        )}
      </div>
      <div className="px-5 pt-4">
        {service.serviceType && <p className="text-[11px] font-bold uppercase tracking-wide text-accent">{service.serviceType.label}</p>}
        <h2 className="mt-1 font-display text-lg font-bold text-primary wrap-break-word">{service.title || "Service name"}</h2>
        <p className="mt-1.5 line-clamp-3 text-sm text-primary/80">{plainExcerpt(service.description) || "Description"}</p>
      </div>
    </>
  );
}
