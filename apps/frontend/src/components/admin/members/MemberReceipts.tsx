"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Receipt } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatInr } from "@/lib/services";
import { formatDate } from "@/lib/memberFormat";
import { useToast } from "@/components/ui/Toast";

interface ReceiptItem {
  id: string;
  number: string;
  issuedAt: string;
  description: string;
  amount: number;
}

// Plan-purchase receipts of one member, with a download link for each PDF.
export default function MemberReceipts({ userId }: { userId: string }) {
  const toast = useToast();
  const [receipts, setReceipts] = useState<ReceiptItem[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ReceiptItem[]>(`/api/v1/admin/receipts?userId=${userId}`)
      .then(setReceipts)
      .catch(() => setReceipts([]));
  }, [userId]);

  async function download(id: string) {
    setOpening(id);
    try {
      const { url } = await api.get<{ url: string }>(`/api/v1/admin/receipts/${id}/download`);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open the receipt");
    } finally {
      setOpening(null);
    }
  }

  if (receipts === null || receipts.length === 0) return null;
  return (
    <div className="border-b border-divider p-6" data-testid="member-receipts">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
        <Receipt size={15} /> Payment receipts
      </p>
      <ul className="divide-y divide-divider rounded-xl border border-divider">
        {receipts.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="w-44 font-semibold tabular-nums text-primary">{r.number}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{r.description}</span>
            <span className="text-xs text-subtle">{formatDate(r.issuedAt)}</span>
            <span className="w-24 text-right font-semibold tabular-nums">{formatInr(r.amount)}</span>
            <button
              type="button"
              onClick={() => download(r.id)}
              disabled={opening === r.id}
              aria-label={`Download receipt ${r.number}`}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent disabled:opacity-60"
            >
              {opening === r.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
