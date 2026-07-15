"use client";

import Link from "next/link";
import { Camera, Crown, Lock, Pencil, Settings } from "lucide-react";
import ChangePasswordModal from "@/components/profile/ChangePasswordModal";
import ToggleSwitch from "@/components/profile/ToggleSwitch";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { initials } from "@/lib/session";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  postNotificationsEnabled: boolean;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [email, setEmail] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ user: UserProfile }>("/auth/me")
      .then((data) => {
        setUser(data.user);
        setEmail(data.user.email);
        setNotificationsEnabled(data.user.postNotificationsEnabled);
      })
      .catch(() => {});
  }, []);

  const handleToggle = () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    api
      .patch("/auth/me/notifications", { postNotificationsEnabled: next })
      .catch(() => setNotificationsEnabled(!next));
  };

  const handleEditDetails = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = await api.patch<{ user: UserProfile }>("/auth/me/email", { email });
      setUser(data.user);
    } catch {
      // no-op
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('avatar', file);
    try {
      const data = await api.postForm<{ user: UserProfile }>('/auth/me/avatar', form);
      setUser(data.user);
    } catch {
      // no-op
    } finally {
      e.target.value = '';
    }
  };

  const displayName = user?.name ?? "Ritesh Kumar";
  const displayInitials = user ? initials(user.name) : "RK";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-primary">Profile</h1>
        <Link
          href="/profile/settings"
          className="flex items-center gap-2 rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <Settings size={16} />
          Settings
        </Link>
      </div>

      <div className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="h-16 bg-accent" />

        <div className="flex flex-wrap items-start justify-between gap-6 px-6 pb-6">
          <div className="-mt-8 flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="flex h-17 w-17 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-4 ring-white overflow-hidden">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  displayInitials
                )}
              </div>
              <button
                type="button"
                aria-label="Change profile photo"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white ring-2 ring-white transition-colors hover:bg-accent/80"
              >
                <Camera size={12} />
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-lg font-bold text-primary">{displayName}</p>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/25"
                >
                  <Pencil size={11} />
                  Edit
                </button>
              </div>
              <p className="text-sm text-subtle">{user?.email ?? "ritesh@example.com"}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#edfad4] px-5 py-4">
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

        <div className="h-px w-full bg-divider" />

        <div className="flex items-center justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold text-primary">New Post Alerts</p>
            <p className="text-xs text-subtle">Get notified when admin publishes a new post</p>
          </div>
          <div onClick={handleToggle}>
            <ToggleSwitch on={notificationsEnabled} />
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2">
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-b-2xl bg-[#f8f7f5] p-6 sm:flex-row sm:justify-end">
          <ChangePasswordModal
            trigger={
              <button className="flex items-center justify-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card">
                <Lock size={14} />
                Change Password
              </button>
            }
          />
          <button
            onClick={handleEditDetails}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-lime to-accent px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Pencil size={14} />
            {saving ? "Saving..." : "Edit Details"}
          </button>
        </div>
      </div>
    </div>
  );
}

