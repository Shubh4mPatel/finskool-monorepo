"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface AuthResponse {
  user: { id: string; name: string; role: string };
  communities: { id: string; name: string; slug: string }[];
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

  const digits = fields.phone.replace(/[\s\-]/g, "");
  if (!digits) errs.phone = "Phone number is required";
  else if (!/^\d{10}$/.test(digits) && !/^\+[1-9]\d{6,14}$/.test(digits))
    errs.phone = "Enter a valid 10-digit phone number";

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
      const digits = value.replace(/[\s\-]/g, "");
      if (!digits) return "Phone number is required";
      if (!/^\d{10}$/.test(digits) && !/^\+[1-9]\d{6,14}$/.test(digits))
        return "Enter a valid 10-digit phone number";
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
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [loading, setLoading] = useState(false);

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
    const raw = phone.replace(/[\s\-]/g, "");
    const normalised = /^\d{10}$/.test(raw) ? `+91${raw}` : raw;

    try {
      const data = await api.post<AuthResponse>("/api/v1/auth/register", {
        fullName,
        phone: normalised,
        email,
        password,
        confirmPassword,
      });

      if (data.user.role === "admin") {
        router.push("/admin/dashboard");
      } else if (data.communities.length === 1) {
        router.push("/feed");
      } else {
        router.push("/");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = (err?: string) =>
    `mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 ${
      err ? "border-red-400 focus:ring-red-200" : "border-divider focus:ring-accent/40"
    }`;

  return (
    <AuthLayout
      heading="Create Your Account"
      bullets={["Your phone number must be on the approved list.", "Enter your details to create your account."]}
    >
      <div className="w-full max-w-md">
        <span className="flex items-center gap-1 text-sm font-semibold text-accent">
          <ChevronRight size={14} />
          Invitation Only
        </span>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
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

          <div>
            <label className="text-sm font-semibold text-primary">Phone Number</label>
            <div
              className={`mt-2 flex overflow-hidden rounded-xl border transition-colors focus-within:border-accent ${
                errors.phone ? "border-red-400" : "border-divider"
              }`}
            >
              <span className="flex items-center bg-primary px-4 text-sm font-semibold text-white">
                +91
              </span>
              <input
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={(e) => change("phone", e.target.value)}
                onBlur={() => blur("phone", phone)}
                className="w-full border-0 bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle focus:outline-none focus:ring-0"
              />
            </div>
            {errors.phone ? (
              <p className="mt-1.5 text-xs text-red-500">{errors.phone}</p>
            ) : (
              <p className="mt-1 text-xs text-subtle">Must match the number your admin registered for you</p>
            )}
          </div>

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

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary py-3 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create My Account"}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-subtle">
          <Lock size={12} />
          Your personal details are never visible to other members
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 border-t border-divider pt-6">
          <span className="text-sm text-muted">Already registered?</span>
          <Link
            href="/login"
            className="rounded-full border border-accent px-4 py-1.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card"
          >
            Login
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
