"use client";

import { Camera, Lock, Pencil } from "lucide-react";
import ChangePasswordModal from "@/components/profile/ChangePasswordModal";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { initials, updateSessionAvatar } from "@/lib/session";

interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export default function AdminProfilePage() {
  const [user, setUser] = useState<AdminProfile | null>(null);
  const [email, setEmail] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ user: AdminProfile }>("/api/v1/auth/me")
      .then((data) => {
        setUser(data.user);
        setEmail(data.user.email);
      })
      .catch(() => {});
  }, []);

  const handleEditDetails = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = await api.patch<{ user: AdminProfile }>("/api/v1/auth/me/email", { email });
      setUser(data.user);
      setIsEditing(false);
    } catch {
      // no-op
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
        `/api/v1/auth/me/avatar/upload-url?filename=${encodeURIComponent(file.name)}`
      );
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const data = await api.patch<{ user: AdminProfile }>("/api/v1/auth/me/avatar", { avatarUrl: publicUrl });
      setUser(data.user);
      updateSessionAvatar(data.user.avatarUrl ?? null);
    } catch {
      // no-op
    } finally {
      e.target.value = "";
    }
  };

  const displayName = user?.name ?? "";
  const displayInitials = user ? initials(user.name) : "";
  const roleLabel = user?.role === "super_admin" ? "Super Admin" : "Admin";

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
            {/* Avatar */}
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-white">
                {user?.avatarUrl
                  ? <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                  : displayInitials
                }
              </div>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow transition-transform hover:scale-110"
                aria-label="Change avatar"
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
              <p className="font-display text-lg font-bold text-primary">{displayName}</p>
              <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-bold text-primary">{roleLabel}</span>
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
                value=""  
                disabled
                className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted"
              />
              <p className="mt-1 text-xs text-subtle">Phone number cannot be changed. Contact system owner.</p>
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">E-mail Address</label>
              <input
                type="email"
                value={email}
                disabled={!isEditing}
                onChange={(e) => setEmail(e.target.value)}
                className={`mt-2 w-full rounded-xl border px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  isEditing
                    ? "border-accent/40 bg-white text-primary"
                    : "border-divider bg-divider/40 text-muted"
                }`}
              />
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="flex flex-col gap-3 p-6 sm:flex-row sm:justify-end">
          <ChangePasswordModal />
          {isEditing ? (
            <>
              <button
                onClick={() => { setEmail(user?.email ?? ""); setIsEditing(false); }}
                className="flex items-center justify-center gap-2 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:bg-divider/60"
              >
                Cancel
              </button>
              <button
                onClick={handleEditDetails}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
            >
              <Pencil size={14} />
              Edit Details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
