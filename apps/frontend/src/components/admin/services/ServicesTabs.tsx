"use client";

import Link from "next/link";
import { useIsSuperAdmin } from "@/lib/session";

const TABS = [
  { href: "/admin/services", label: "Enquiries", key: "enquiries" },
  { href: "/admin/services/catalog", label: "Services", key: "catalog" },
] as const;

/**
 * Switches between the enquiry inbox and the service catalog. Only super admins manage the catalog,
 * so everyone else sees no tabs at all (just the inbox).
 */
export default function ServicesTabs({ active }: { active: "enquiries" | "catalog" }) {
  const isSuperAdmin = useIsSuperAdmin();
  if (!isSuperAdmin) return null;
  return (
    <div className="animate-enter flex w-fit gap-1 rounded-full bg-white p-1 shadow-card ring-1 ring-primary/[0.04]" role="tablist">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={active === t.key}
          className={`rounded-full px-5 py-2 text-sm font-bold transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 ${
            active === t.key ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-background hover:text-primary"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
