import Link from "next/link";
import { ArrowLeft, Camera, Crown, Lock, Pencil } from "lucide-react";
import ChangePasswordModal from "@/components/profile/ChangePasswordModal";
import ToggleSwitch from "@/components/profile/ToggleSwitch";

export default function ProfileSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-divider/60"
          aria-label="Back to profile"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-primary">Profile Settings</h1>
      </div>

      <div className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="h-16 bg-primary" />

        <div className="flex flex-wrap items-start justify-between gap-6 px-6 pb-6">
          <div className="-mt-8 flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="flex h-17 w-17 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-4 ring-white">
                RK
              </div>
              <button
                type="button"
                aria-label="Change profile photo"
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white ring-2 ring-white transition-colors hover:bg-accent/80"
              >
                <Camera size={12} />
              </button>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-lg font-bold text-primary">Ritesh Kumar</p>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/25"
                >
                  <Pencil size={11} />
                  Edit
                </button>
              </div>
              <p className="text-sm text-subtle">ritesh@example.com</p>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-8">
            <div>
              <p className="text-xs text-subtle">Member Since</p>
              <p className="font-semibold text-primary">12 May 2026</p>
            </div>
            <div className="h-10 w-px bg-divider" />
            <div>
              <p className="text-xs text-subtle">Community</p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-lime bg-lime/10 px-3 py-1 text-xs font-semibold text-primary">
                ⚡ Swing Alpha
              </span>
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#4caf50] bg-[#edfad4] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lime">
                <Crown size={18} />
              </div>
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <span className="h-2 w-2 rounded-full bg-[#4caf50]" />
                  Active Subscription
                </p>
                <p className="text-xs text-[#5a7a50]">Expires: 15 Aug 2026</p>
              </div>
            </div>
            <span className="text-sm font-bold text-accent">92 days remaining</span>
          </div>
        </div>
      </div>

      <div className="animate-rise rounded-2xl bg-white p-6 shadow-card">
        <h2 className="font-display text-base font-bold text-primary">Account Settings</h2>
        <div className="mt-4 h-px w-full bg-divider" />
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold text-primary">Phone Number</label>
            <input
              type="text"
              value="+919898989890"
              disabled
              className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black"
            />
            <p className="mt-1 text-xs text-subtle">Phone number cannot be changed. Contact admin.</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-primary">E-mail Address</label>
            <input
              type="email"
              defaultValue="ritesh@example.com"
              className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>
      </div>

      <div className="animate-rise rounded-2xl bg-white p-6 shadow-card">
        <h2 className="font-display text-base font-bold text-primary">Notifications</h2>
        <div className="mt-4 h-px w-full bg-divider" />
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary">New Post Alerts</p>
              <p className="text-xs text-subtle">Get notified when admin publishes a new post</p>
            </div>
            <ToggleSwitch on />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary">Subscription Reminders</p>
              <p className="text-xs text-subtle">Receive email when your subscription is about to expire</p>
            </div>
            <ToggleSwitch on />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <ChangePasswordModal
          trigger={
            <button className="flex items-center justify-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card">
              <Lock size={14} />
              Change Password
            </button>
          }
        />
        <button className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-lime to-accent px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95">
          <Pencil size={14} />
          Edit Details
        </button>
      </div>
    </div>
  );
}
