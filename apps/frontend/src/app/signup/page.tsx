"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, ChevronRight, Lock } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import PhoneInput from "@/components/ui/PhoneInput";
import { api, ApiError } from "@/lib/api";
import { saveSession, initials } from "@/lib/session";

interface AuthResponse {
  user: { id: string; name: string; role: string; isSuperAdmin: boolean; avatarUrl?: string | null };
  communities: { id: string; name: string; slug: string; badgeUrl: string | null }[];
}

type FieldErrors = {
  fullName?: string;
  phone?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

function validate(fields: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
}): FieldErrors {
  const errs: FieldErrors = {};
  if (fields.fullName.trim().length < 2)
    errs.fullName = "Full name must be at least 2 characters";

  if (!fields.phone) errs.phone = "Phone number is required";
  else if (!isValidPhoneNumber(fields.phone))
    errs.phone = "Enter a valid phone number";

  if (!fields.email) errs.email = "Email is required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
    errs.email = "Enter a valid email address";

  if (fields.password.length < 8)
    errs.password = "Password must be at least 8 characters";

  if (!fields.confirmPassword) errs.confirmPassword = "Please confirm your password";
  else if (fields.confirmPassword !== fields.password)
    errs.confirmPassword = "Passwords do not match";

  return errs;
}

function validateField(
  field: keyof FieldErrors,
  value: string,
  password?: string,
): string | undefined {
  switch (field) {
    case "fullName":
      return value.trim().length < 2 ? "Full name must be at least 2 characters" : undefined;
    case "phone": {
      if (!value) return "Phone number is required";
      if (!isValidPhoneNumber(value)) return "Enter a valid phone number";
      return undefined;
    }
    case "email":
      if (!value) return "Email is required";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Enter a valid email address";
    case "password":
      return value.length < 8 ? "Password must be at least 8 characters" : undefined;
    case "confirmPassword":
      if (!value) return "Please confirm your password";
      return value !== password ? "Passwords do not match" : undefined;
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function blur(field: keyof FieldErrors, value: string) {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((e) => ({
      ...e,
      [field]: validateField(field, value, password),
    }));
  }

  function change(field: keyof FieldErrors, value: string) {
    switch (field) {
      case "fullName": setFullName(value); break;
      case "phone": setPhone(value); break;
      case "email": setEmail(value); break;
      case "password": {
        setPassword(value);
        // Keep confirm-password error in sync
        if (touched.confirmPassword)
          setErrors((e) => ({ ...e, confirmPassword: validateField("confirmPassword", confirmPassword, value) }));
        break;
      }
      case "confirmPassword": setConfirmPassword(value); break;
    }
    if (touched[field])
      setErrors((e) => ({
        ...e,
        [field]: validateField(
          field,
          value,
          field === "confirmPassword" ? password : undefined,
        ),
      }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const allErrs = validate({ fullName, phone, email, password, confirmPassword });
    setTouched({ fullName: true, phone: true, email: true, password: true, confirmPassword: true });
    setErrors(allErrs);
    if (Object.values(allErrs).some(Boolean)) return;

    setLoading(true);
    setApiError(null);

    try {
      const data = await api.post<AuthResponse>("/api/v1/auth/register", {
        fullName,
        phone,
        email,
        password,
        confirmPassword,
      });

      if (data.user.role === "admin") {
        router.push("/admin/dashboard");
      } else if (data.communities.length === 1) {
        const comm = data.communities[0]!;
        saveSession({ userId: data.user.id, userName: data.user.name, userInitials: initials(data.user.name), communityName: comm.name, communityId: comm.id, communityBadgeUrl: comm.badgeUrl, avatarUrl: data.user.avatarUrl ?? null, isSuperAdmin: data.user.isSuperAdmin });
        router.push("/feed");
      } else {
        saveSession({ userId: data.user.id, userName: data.user.name, userInitials: initials(data.user.name), communityName: "", communityId: "", avatarUrl: data.user.avatarUrl ?? null, isSuperAdmin: data.user.isSuperAdmin });
        router.push("/");
      }
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = (err?: string) =>
    `mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm text-primary placeholder:text-[#b0aba1] transition-colors focus:outline-none focus:border-accent ${
      err ? "border-red-400" : "border-[#d6d2c8]"
    }`;

  return (
    <AuthLayout
      heading="Create Your Account"
      bullets={["Your phone number must be on the approved list.", "Enter your details to create your account."]}
    >
      <div className="w-full max-w-xl">
        {/* Error banner */}
        {apiError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border-l-4 border-red-400 bg-[#fff5f5] px-4 py-3.5">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-sm text-red-700">{apiError}</p>
          </div>
        )}

        {/* Invitation Only badge — above the card */}
        <span className="mb-4 flex items-center gap-1 text-sm font-semibold text-accent">
          <ChevronRight size={14} />
          Invitation Only
        </span>

        {/* White card */}
        <div className="rounded-2xl bg-white px-10 py-8 shadow-card">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Full Name */}
            <div>
              <label className="text-sm font-semibold text-primary">Full Name</label>
              <input
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => change("fullName", e.target.value)}
                onBlur={() => blur("fullName", fullName)}
                className={fieldClass(errors.fullName)}
              />
              {errors.fullName && (
                <p className="mt-1.5 text-xs text-red-500">{errors.fullName}</p>
              )}
            </div>

            {/* Phone Number */}
            <div>
              <label className="text-sm font-semibold text-primary">Phone Number</label>
              <div className="mt-2">
                <PhoneInput
                  value={phone}
                  onChange={(v) => change("phone", v)}
                  onBlur={() => blur("phone", phone)}
                  hasError={!!errors.phone}
                />
              </div>
              {errors.phone && (
                <p className="mt-1.5 text-xs text-red-500">{errors.phone}</p>
              )}
              <p className="mt-1 text-xs text-subtle">Must match the number your admin registered for you</p>
            </div>

            {/* Email Address */}
            <div>
              <label className="text-sm font-semibold text-primary">Email Address</label>
              <input
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => change("email", e.target.value)}
                onBlur={() => blur("email", email)}
                className={fieldClass(errors.email)}
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-500">{errors.email}</p>
              )}
            </div>

            {/* Password row — side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Set Password</label>
                <div className="mt-2">
                  <PasswordInput
                    value={password}
                    onChange={(e) => change("password", e.target.value)}
                    onBlur={() => blur("password", password)}
                    hasError={!!errors.password}
                  />
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.password}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Confirm Password</label>
                <div className="mt-2">
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => change("confirmPassword", e.target.value)}
                    onBlur={() => blur("confirmPassword", confirmPassword)}
                    hasError={!!errors.confirmPassword}
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.confirmPassword}</p>
                )}
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex items-center justify-center gap-2 rounded-full py-4 px-8 text-sm font-bold text-white transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
            >
              {loading ? "Creating account…" : "Create My Account"}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <hr className="mt-6 border-divider" />

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-subtle">
            <Lock size={12} />
            Your personal details are never visible to other members
          </p>
        </div>

        {/* Outside card — login prompt */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <span className="text-sm text-muted">Already registered?</span>
          <Link
            href="/login"
            className="rounded-full border border-accent px-5 py-1.5 text-sm font-semibold text-accent transition-all duration-300 hover:bg-accent/5"
          >
            Login
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
