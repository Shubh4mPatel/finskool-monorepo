"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import type { KitListItem } from "@/lib/welcome-kit";

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function WelcomeKitListPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<KitListItem[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<KitListItem[]>("/api/v1/admin/welcome-kits")
      .then(setItems)
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "Failed to load communities");
        setItems([]);
      });
  }, [toast]);

  async function handleDelete(c: KitListItem) {
    const ok = await confirm({
      title: "Delete welcome kit?",
      message: `This removes the welcome kit for "${c.name}". Members will no longer see it in the app. You can add a new one afterwards.`,
      confirmLabel: "Yes, Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(c.communityId);
    try {
      await api.delete(`/api/v1/admin/communities/${c.communityId}/welcome-kit`);
      toast.success(`Welcome kit for ${c.name} deleted.`);
      setItems((prev) => prev?.map((x) => (x.communityId === c.communityId ? { ...x, hasKit: false, updatedAt: null } : x)) ?? prev);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete the welcome kit");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Welcome Kit</p>
        <h1 className="font-display text-2xl font-bold text-primary">Welcome Kit</h1>
        <p className="mt-1 text-sm text-muted">
          Add a welcome kit for each paid community. Subscribed members see it in the app.
        </p>
      </div>

      {items === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-card">
          <Gift size={28} className="mx-auto text-subtle" />
          <p className="mt-3 text-sm text-muted">There are no paid communities you can add a welcome kit to.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((c) => (
            <div key={c.communityId} className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-card">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-lg">
                <CommunityBadgeIcon badgeUrl={c.badgeUrl} className="h-7 w-7 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-bold text-primary">{c.name}</p>
                <p className="text-xs text-muted">
                  {c.hasKit && c.updatedAt ? `Updated ${formatUpdated(c.updatedAt)}` : "No welcome kit yet"}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${c.hasKit ? "bg-lime/40 text-primary" : "bg-divider/70 text-muted"}`}
              >
                {c.hasKit ? "Kit added" : "Not added"}
              </span>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/welcome-kit/${c.communityId}`}
                  className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
                  style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
                >
                  {c.hasKit ? <Pencil size={12} /> : <Plus size={13} />}
                  {c.hasKit ? "Edit" : "Add kit"}
                </Link>
                {c.hasKit && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(c)}
                    disabled={deletingId === c.communityId}
                    aria-label={`Delete welcome kit for ${c.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
