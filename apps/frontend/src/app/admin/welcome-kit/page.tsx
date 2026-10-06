"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import type { KitListItem } from "@/lib/welcome-kit";

const roundBtn =
  "flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform hover:scale-110 active:scale-95";

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
        <p className="mt-1 text-sm text-muted">View and manage welcome kits.</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-primary">
          <Gift size={16} className="text-muted" />
          Manage Welcome Kits
        </h2>
        <p className="mt-1 text-sm text-muted">Create and manage the kits members receive with their subscription.</p>

        {items === null ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-[117px] animate-pulse rounded-xl bg-divider/60" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">There are no paid communities you can add a welcome kit to.</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((c) => (
              <div
                key={c.communityId}
                className="group relative flex h-[117px] items-end overflow-hidden rounded-xl text-white transition-shadow duration-300 hover:shadow-card-hover"
                style={{ background: "linear-gradient(120deg, #0a5f57, #108b8b)" }}
              >
                {c.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
                <span className="absolute inset-0 bg-gradient-to-r from-[#0a5f57]/95 via-[#0a5f57]/70 to-transparent" />

                {/* The whole card opens the editor; the buttons sit above it. */}
                <Link
                  href={`/admin/welcome-kit/${c.communityId}`}
                  aria-label={`${c.hasKit ? "Edit" : "Add"} welcome kit for ${c.name}`}
                  className="absolute inset-0 z-10"
                />

                <span className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white">
                  <CommunityBadgeIcon badgeUrl={c.badgeUrl} className="h-5 w-5 object-contain" />
                </span>

                <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
                  <Link
                    href={`/admin/welcome-kit/${c.communityId}`}
                    title={c.hasKit ? "Edit welcome kit" : "Add welcome kit"}
                    aria-label={c.hasKit ? "Edit welcome kit" : "Add welcome kit"}
                    className={`${roundBtn} text-accent`}
                  >
                    {c.hasKit ? <Pencil size={11} /> : <Plus size={13} strokeWidth={2.5} />}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleDelete(c)}
                    disabled={!c.hasKit || deletingId === c.communityId}
                    title={c.hasKit ? "Delete welcome kit" : "No kit to delete"}
                    aria-label="Delete welcome kit"
                    className={`${roundBtn} text-red-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <div className="relative flex w-full flex-col gap-1 p-4 pt-14">
                  {c.type && <span className="text-[10px] font-semibold text-white/80">{c.type}</span>}
                  <span className="font-display text-base font-bold leading-tight">{c.name}</span>
                  <span className="w-fit rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-primary">
                    {c.hasKit ? "Added" : "Not Added"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
