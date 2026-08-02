"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Ban, Key, Pencil, Trash2 } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PhoneInput from "@/components/ui/PhoneInput";
import PasswordInput from "@/components/auth/PasswordInput";
import {
  type MemberItem,
  STATUS_STYLES,
  STATUS_LABELS,
  getInitials,
  formatCurrency,
  formatDate,
  communityBadge,
} from "@/lib/memberFormat";

type FormErrors = Partial<Record<"name" | "phone" | "email", string>>;

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [member, setMember] = useState<MemberItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const [suspending, setSuspending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get<MemberItem>(`/api/v1/admin/members/${params.id}`)
      .then((m) => {
        setMember(m);
        setForm({ name: m.name, phone: m.phone, email: m.email });
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Failed to load member"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // toast is a stable context ref; only re-fetch when the id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function validate(): FormErrors {
    const e: FormErrors = {};
    if (form.name.trim().length < 2) e.name = "Name must be at least 2 characters";
    if (!form.phone) e.phone = "Phone is required";
    else if (!isValidPhoneNumber(form.phone)) e.phone = "Enter a valid phone number";
    if (!form.email) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Invalid email address";
    return e;
  }

  async function handleSave() {
    if (!member) return;
    const errs = validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    try {
      const updated = await api.patch<MemberItem>(`/api/v1/admin/members/${member.id}`, form);
      setMember(updated);
      setForm({ name: updated.name, phone: updated.phone, email: updated.email });
      setIsEditing(false);
      toast.success({ title: "Member updated", message: `${updated.name} has been updated.` });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member");
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspend() {
    if (!member) return;
    if (!suspendReason.trim()) {
      toast.error("Please provide a reason for suspension");
      return;
    }
    setSuspending(true);
    try {
      await api.patch(`/api/v1/admin/members/${member.id}/suspend`, { reason: suspendReason.trim() });
      toast.success({ title: "Member suspended", message: `${member.name} can no longer sign in.` });
      setSuspendModalOpen(false);
      setSuspendReason("");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to suspend member");
    } finally {
      setSuspending(false);
    }
  }

  async function handleRevoke() {
    if (!member) return;
    const ok = await confirm({
      title: "Revoke Suspension?",
      message: `This will restore ${member.name}'s access and let them sign in again.`,
      confirmLabel: "Yes, Revoke",
      variant: "positive",
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await api.patch(`/api/v1/admin/members/${member.id}/revoke`, {});
      toast.success({ title: "Suspension revoked", message: `${member.name} can sign in again.` });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke suspension");
    } finally {
      setRevoking(false);
    }
  }

  async function handleDelete() {
    if (!member) return;
    const ok = await confirm({
      title: "Deactivate Member?",
      message: `This will revoke ${member.name}'s access — they'll be logged out and won't be able to sign in again. This can't be undone from here.`,
      confirmLabel: "Yes, Deactivate",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete(`/api/v1/admin/members/${member.id}`);
      toast.success({ title: "Member deactivated", message: `${member.name} no longer has access to the platform.` });
      router.push("/admin/members");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to deactivate member");
      setDeleting(false);
    }
  }

  async function handleResetPassword() {
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    if (!member) return;
    setResettingPassword(true);
    try {
      await api.patch(`/api/v1/admin/members/${member.id}/password`, { newPassword });
      toast.success({ title: "Password updated", message: `${member.name}'s password has been reset.` });
      setPasswordModalOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Failed to reset password");
    } finally {
      setResettingPassword(false);
    }
  }

  const fieldCls = (err?: string) =>
    `mt-2 w-full rounded-xl border px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 ${
      err
        ? "border-red-400 focus:ring-red-200"
        : isEditing
          ? "border-accent/40 bg-white text-primary focus:ring-accent/40"
          : "border-divider bg-divider/40 text-muted"
    }`;

  if (loading) {
    return <div className="h-72 animate-pulse rounded-2xl bg-white shadow-card" />;
  }
  if (!member) {
    return <p className="text-sm text-muted">Member not found.</p>;
  }

  const sub = member.subscription;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button onClick={() => router.push("/admin/members")} className="text-xs font-semibold text-accent hover:underline">
          &larr; Back to Members
        </button>
        <h1 className="mt-1 font-display text-2xl font-bold text-primary">Member Profile</h1>
      </div>

      <div className="animate-rise rounded-2xl bg-white shadow-card">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-primary via-accent to-lime" />

        <div className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-white">
              {getInitials(member.name)}
            </div>
            <div>
              <p className="font-display text-lg font-bold text-primary">{member.name}</p>
              <span className={`mt-1 inline-block rounded-full px-3 py-0.5 text-xs font-bold ${STATUS_STYLES[member.status] ?? ""}`}>
                {STATUS_LABELS[member.status] ?? member.status}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {member.allSubscriptions.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {member.allSubscriptions.map((s) => (
                  <span key={s.id} className={`rounded-full px-3 py-1 text-xs font-bold ${communityBadge(s.communityName)}`}>
                    {s.communityName}
                  </span>
                ))}
              </div>
            )}
            {sub && (
              <p className="text-xs text-subtle">
                {formatCurrency(sub.payment)} &middot; Valid till {formatDate(sub.validUntil)}
              </p>
            )}
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-primary">Full Name</label>
              <input
                type="text"
                value={form.name}
                disabled={!isEditing}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={fieldCls(errors.name)}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Phone Number</label>
              {isEditing ? (
                <div className="mt-2">
                  <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v ?? "" }))} hasError={!!errors.phone} />
                </div>
              ) : (
                <input type="text" value={form.phone} disabled className={fieldCls()} />
              )}
              {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">E-mail Address</label>
              <input
                type="email"
                value={form.email}
                disabled={!isEditing}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={fieldCls(errors.email)}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Paid On</label>
              <input type="text" value={formatDate(sub?.paidOn)} disabled className={fieldCls()} />
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Registered</label>
              <input type="text" value={member.isRegistered ? "Yes" : "Not yet"} disabled className={fieldCls()} />
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Member Since</label>
              <input type="text" value={formatDate(member.createdAt)} disabled className={fieldCls()} />
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPasswordModalOpen(true)}
              className="flex items-center justify-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5"
            >
              <Key size={14} /> Change Password
            </button>
            {member.status !== "deleted" &&
              (member.status === "suspended" ? (
                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  className="flex items-center justify-center gap-2 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:bg-divider/60 disabled:opacity-60"
                >
                  <Ban size={14} /> Revoke Suspension
                </button>
              ) : (
                <button
                  onClick={() => setSuspendModalOpen(true)}
                  className="flex items-center justify-center gap-2 rounded-full border border-amber-400 px-5 py-2.5 text-sm font-bold text-amber-600 transition-colors hover:bg-amber-50"
                >
                  <Ban size={14} /> Suspend User
                </button>
              ))}
            {member.status !== "deleted" && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center justify-center gap-2 rounded-full border border-red-300 px-5 py-2.5 text-sm font-bold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                <Trash2 size={14} /> Deactivate
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setForm({ name: member.name, phone: member.phone, email: member.email });
                  setErrors({});
                  setIsEditing(false);
                }}
                className="flex items-center justify-center gap-2 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:bg-divider/60"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
            >
              <Pencil size={14} /> Edit Details
            </button>
          )}
        </div>
      </div>

      {suspendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <h3 className="font-display text-lg font-bold text-primary">Suspend {member.name}?</h3>
            <p className="mt-1 text-sm text-muted">They&rsquo;ll be logged out and unable to sign in until you revoke the suspension.</p>
            <label className="mt-4 block text-sm font-semibold text-primary">Reason</label>
            <textarea
              rows={4}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Enter reason..."
              className="mt-2 w-full rounded-xl border border-divider px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setSuspendModalOpen(false)} className="rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:bg-divider/60">
                Cancel
              </button>
              <button
                onClick={handleSuspend}
                disabled={suspending}
                className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 disabled:opacity-60"
              >
                {suspending ? "Suspending…" : "Suspend"}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <h3 className="font-display text-lg font-bold text-primary">Reset Password</h3>
            <p className="mt-1 text-sm text-muted">Set a new password for {member.name}. They won&rsquo;t be notified automatically.</p>
            <label className="mt-4 block text-sm font-semibold text-primary">New Password</label>
            <div className="mt-2">
              <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <label className="mt-4 block text-sm font-semibold text-primary">Confirm Password</label>
            <div className="mt-2">
              <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            {passwordError && <p className="mt-2 text-xs text-red-500">{passwordError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setPasswordModalOpen(false);
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordError("");
                }}
                className="rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:bg-divider/60"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resettingPassword}
                className="rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 disabled:opacity-60"
              >
                {resettingPassword ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
