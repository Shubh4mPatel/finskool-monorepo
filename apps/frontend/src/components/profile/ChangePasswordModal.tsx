"use client";

import { Lock, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError } from "@/lib/api";

export default function ChangePasswordModal({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setError("");
  };

  const handleSave = async () => {
    setError("");
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch("/api/v1/auth/me/password", { currentPassword, newPassword, confirmNewPassword });
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="contents">
          {trigger}
        </span>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card"
        >
          <Lock size={14} />
          Change Password
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Change Password</h3>
              <button
                onClick={handleClose}
                className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Current Password</label>
                <div className="mt-2">
                  <PasswordInput
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">New Password</label>
                <div className="mt-2">
                  <PasswordInput
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Confirm New Password</label>
                <div className="mt-2">
                  <PasswordInput
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    hasError={!!error}
                  />
                </div>
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleClose}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="flex-1 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

