"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, Crown, Lock, Pencil, Trash2 } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PhoneInput from "@/components/ui/PhoneInput";
import PasswordInput from "@/components/auth/PasswordInput";
import { type MemberItem, getInitials, formatDate } from "@/lib/memberFormat";

type FormErrors = Partial<Record<"name" | "phone" | "email", string>>;

function daysRemaining(validUntil: string): number {
  const ms = new Date(validUntil).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

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

  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendPayment, setExtendPayment] = useState("");
  const [extendDate, setExtendDate] = useState("");
  const [extendErrors, setExtendErrors] = useState<{ payment?: string; extendDate?: string }>({});
  const [extending, setExtending] = useState(false);

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

  function handleCancelEdit() {
    if (!member) return;
    setForm({ name: member.name, phone: member.phone, email: member.email });
    setErrors({});
    setIsEditing(false);
  }

  function openExtendModal() {
    if (!member?.subscription) {
      toast.error("This member has no subscription to extend");
      return;
    }
    setExtendPayment(String(member.subscription.payment));
    setExtendDate("");
    setExtendErrors({});
    setExtendModalOpen(true);
  }

  function validateExtend(): { payment?: string; extendDate?: string } {
    const errs: { payment?: string; extendDate?: string } = {};
    const amt = parseFloat(extendPayment);
    if (!extendPayment || isNaN(amt) || amt <= 0) errs.payment = "Enter a valid payment amount";
    if (!extendDate) errs.extendDate = "Extend date is required";
    else if (new Date(extendDate) <= new Date()) errs.extendDate = "Extend date must be in the future";
    return errs;
  }

  async function handleExtend() {
    if (!member?.subscription) return;
    const errs = validateExtend();
    setExtendErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setExtending(true);
    try {
      await api.post(`/api/v1/admin/subscriptions/${member.subscription.id}/extend`, {
        validUntil: extendDate,
        payment: parseFloat(extendPayment),
      });
      toast.success({ title: "Subscription extended", message: `${member.name}'s subscription is now valid until ${formatDate(extendDate)}` });
      setExtendModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to extend subscription");
    } finally {
      setExtending(false);
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

  if (loading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-white shadow-card" />;
  }
  if (!member) {
    return <p className="text-sm text-muted">Member not found.</p>;
  }

  const sub = member.subscription;
  const displayInitials = getInitials(member.name);

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-rise overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="relative h-16 bg-accent">
          <button
            type="button"
            onClick={() => router.push("/admin/members")}
            aria-label="Back to members"
            className="absolute left-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/15 text-white transition-colors hover:bg-black/25"
          >
            <ArrowLeft size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-6 px-6 pb-6">
          <div className="flex items-center gap-4">
            {/* position:relative (not a margin on the flex row) so only the avatar visually
                overlaps the header bar — a shared -mt-8 on the row would drag the name/email
                text up into the bar too, since align-items:center centers siblings together. */}
            <div className="relative -top-8 shrink-0">
              <div className="flex h-17 w-17 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-primary text-xl font-bold text-lime ring-4 ring-white">
                {displayInitials}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="rounded-lg border border-accent bg-white px-2 py-1 font-display text-lg font-bold text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                ) : (
                  <p className="font-display text-lg font-bold text-primary">{member.name}</p>
                )}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1 rounded-full bg-divider px-2 py-0.5 text-xs font-semibold text-muted transition-colors hover:bg-divider/70"
                  >
                    <Pencil size={10} /> Edit
                  </button>
                )}
              </div>
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
              <p className="text-sm text-subtle">{member.email}</p>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-8">
            <div>
              <p className="text-xs text-subtle">Member Since</p>
              <p className="font-semibold text-primary">{formatDate(member.createdAt)}</p>
            </div>
            {sub && (
              <>
                <div className="h-10 w-px bg-divider" />
                <div>
                  <p className="text-xs text-subtle">Community</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-lime bg-lime/10 px-3 py-1 text-xs font-semibold text-primary">
                    ⚡ {sub.communityName}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#edfad4] px-5 py-4">
            {sub ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lime">
                    <Crown size={18} />
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                      <span className="h-2 w-2 rounded-full bg-[#4caf50]" />
                      Active Subscription
                    </p>
                    <p className="text-xs text-[#5a7a50]">Expires: {formatDate(sub.validUntil)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-accent">{daysRemaining(sub.validUntil)} days remaining</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No active subscription</p>
            )}

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openExtendModal}
                disabled={!sub}
                className="rounded-full border border-accent bg-white px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Extend
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                aria-label="Edit member"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-muted transition-colors hover:bg-divider/60 hover:text-accent"
              >
                <Pencil size={14} />
              </button>
              {member.status !== "deleted" && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  aria-label="Deactivate member"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-red-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-60"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-divider" />

        <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold text-primary">Phone Number</label>
            {isEditing ? (
              <div className="mt-2">
                <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v ?? "" }))} hasError={!!errors.phone} />
              </div>
            ) : (
              <input type="text" value={form.phone} disabled className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black" />
            )}
            {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold text-primary">E-mail Address</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={!isEditing}
              className={`mt-2 w-full rounded-[10px] border px-4 py-3 text-sm text-black placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                isEditing ? "border-accent bg-white" : "cursor-default border-[#d6d2c8] bg-[#f8f7f5]"
              }`}
            />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold text-primary">Paid On</label>
            <input type="text" value={formatDate(sub?.paidOn)} disabled className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black" />
          </div>
          <div>
            <label className="text-sm font-semibold text-primary">Registered</label>
            <input type="text" value={member.isRegistered ? "Yes" : "Not yet"} disabled className="mt-2 w-full rounded-[10px] border border-[#d6d2c8] bg-[#f8f7f5] px-4 py-3 text-sm text-black" />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-b-2xl bg-[#f8f7f5] p-6 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={() => setPasswordModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-full border border-accent px-5 py-2.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card"
          >
            <Lock size={14} />
            Change Password
          </button>

          {member.status !== "deleted" &&
            (member.status === "suspended" ? (
              <button
                type="button"
                onClick={handleRevoke}
                disabled={revoking}
                className="flex items-center justify-center gap-2 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-60"
              >
                <Ban size={14} />
                Revoke Suspension
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSuspendModalOpen(true)}
                className="flex items-center justify-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-600"
              >
                Suspend user
              </button>
            ))}

          {isEditing ? (
            <>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex items-center justify-center gap-2 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-lime to-accent px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Pencil size={14} />
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {extendModalOpen && member.subscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <h3 className="font-display text-lg font-bold text-primary">Extend Subscription</h3>
            <p className="mt-1 text-sm text-muted">Extend {member.name}&rsquo;s subscription to {member.subscription.communityName}.</p>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Current Date</label>
                <input
                  type="text"
                  value={new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  disabled
                  className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Payment (₹)</label>
                <input
                  type="number"
                  placeholder="4000"
                  value={extendPayment}
                  onChange={(e) => setExtendPayment(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                {extendErrors.payment && <p className="mt-1 text-xs text-red-500">{extendErrors.payment}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Extend Date</label>
                <input
                  type="date"
                  value={extendDate}
                  onChange={(e) => setExtendDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                {extendErrors.extendDate && <p className="mt-1 text-xs text-red-500">{extendErrors.extendDate}</p>}
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setExtendModalOpen(false)}
                disabled={extending}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExtend}
                disabled={extending}
                className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {extending ? "Extending…" : "Extend Subscription"}
              </button>
            </div>
          </div>
        </div>
      )}

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
