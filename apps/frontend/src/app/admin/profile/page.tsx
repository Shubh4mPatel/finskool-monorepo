import { Lock, Pencil } from "lucide-react";
import ChangePasswordModal from "@/components/profile/ChangePasswordModal";

export default function AdminProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Admin Profile</p>
        <h1 className="font-display text-2xl font-bold text-primary">Basic Information</h1>
      </div>

      <div className="animate-rise rounded-2xl bg-white shadow-card">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-primary via-accent to-lime" />

        <div className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-white">
              RK
            </div>
            <div>
              <p className="font-display text-lg font-bold text-primary">Ritesh Kumar</p>
              <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-bold text-primary">Super Admin</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-subtle">Community</p>
              <div className="mt-1 flex gap-2">
                <span className="rounded-full bg-lime/40 px-2.5 py-0.5 text-xs font-bold text-primary">Swing Alpha</span>
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">Investor</span>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-primary">Phone Number</label>
              <input
                type="text"
                value="+919898989890"
                disabled
                className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted"
              />
              <p className="mt-1 text-xs text-subtle">Phone number cannot be changed. Contact system owner.</p>
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">E mail Address</label>
              <input
                type="email"
                defaultValue="ritesh@example.com"
                className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="flex flex-col gap-3 p-6 sm:flex-row sm:justify-end">
          <ChangePasswordModal />
          <button className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95">
            <Pencil size={14} />
            Edit Details
          </button>
        </div>
      </div>
    </div>
  );
}
