"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useIsSuperAdmin } from "@/lib/session";
import ServiceForm from "@/components/admin/services/ServiceForm";

export default function EditServicePage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const isSuperAdmin = useIsSuperAdmin();
  if (isSuperAdmin === null) return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm font-semibold text-primary">Only super admins can edit services.</p>
        <Link href="/admin/services" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to services</Link>
      </div>
    );
  }
  return <ServiceForm key={serviceId} serviceId={serviceId} />;
}
