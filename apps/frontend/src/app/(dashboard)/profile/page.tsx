import { Crown, Pencil } from "lucide-react";
import ChangePasswordModal from "@/components/profile/ChangePasswordModal";

function ToggleSwitch({ on }: { on?: boolean }) {
  return (
    <div
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-300 ${
        on ? "bg-lime" : "bg-divider"
      }`}
    >
      <div
        className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </div>
  );
}

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-primary">Profile</h1>

      <div className="animate-rise rounded-2xl bg-white shadow-card">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-primary via-accent to-lime" />

        <div className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-white">
              RK
            </div>
            <div>
              <p className="font-display text-lg font-bold text-primary">Ritesh Kumar</p>
              <p className="text-sm text-subtle">ritesh@example.com</p>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-subtle">Member Since</p>
              <p className="font-semibold text-primary">12 May 2026</p>
            </div>
            <div className="h-10 w-px bg-divider" />
            <div>
              <p className="text-xs text-subtle">Community</p>
              <p className="font-bold text-accent">Swing Alpha</p>
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-xl bg-gradient-to-r from-lime/40 via-lime/20 to-transparent px-5 py-4">
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-lime/30 blur-2xl" />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lime shadow-glow">
                <Crown size={18} />
              </div>
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                  Active Subscription
                </p>
                <p className="text-xs text-subtle">Expires: 15 Aug 2026</p>
              </div>
            </div>
            <span className="text-sm font-bold text-accent">92 days remaining</span>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <h2 className="font-display text-base font-bold text-primary">Notifications</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">New Post Alerts</p>
                <p className="text-xs text-subtle">Get notified when admin publishes a new post</p>
              </div>
              <ToggleSwitch on />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">Subscription Reminders</p>
                <p className="text-xs text-subtle">Receive email when your subscription is about to expire</p>
              </div>
              <ToggleSwitch on />
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <h2 className="font-display text-base font-bold text-primary">Account Settings</h2>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-primary">Phone Number</label>
              <input
                type="text"
                value="+919898989890"
                disabled
                className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted"
              />
              <p className="mt-1 text-xs text-subtle">Phone number cannot be changed. Contact admin.</p>
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">E mail Address</label>
              <input
                type="email"
                placeholder="Enter email"
                defaultValue="meghna@example.com"
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
