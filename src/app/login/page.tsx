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

type FieldErrors = { phone?: string; password?: string };

function validatePhone(raw: string): string | undefined {
  const digits = raw.replace(/[\s\-]/g, "");
  if (!digits) return "Phone number is required";
  if (!/^\d{10}$/.test(digits) && !/^\+[1-9]\d{6,14}$/.test(digits))
    return "Enter a valid 10-digit phone number";
}

function validatePassword(value: string): string | undefined {
  if (!value) return "Password is required";
}

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  function blurField(field: keyof FieldErrors, value: string) {
    setTouched((t) => ({ ...t, [field]: true }));
    const msg =
      field === "phone" ? validatePhone(value) : validatePassword(value);
    setErrors((e) => ({ ...e, [field]: msg }));
  }

  function changePhone(value: string) {
    setPhone(value);
    if (touched.phone)
      setErrors((e) => ({ ...e, phone: validatePhone(value) }));
  }

  function changePassword(value: string) {
    setPassword(value);
    if (touched.password)
      setErrors((e) => ({ ...e, password: validatePassword(value) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate all fields on submit
    const phoneErr = validatePhone(phone);
    const passwordErr = validatePassword(password);
    setTouched({ phone: true, password: true });
    setErrors({ phone: phoneErr, password: passwordErr });
    if (phoneErr || passwordErr) return;

    setLoading(true);
    const raw = phone.replace(/[\s\-]/g, "");
    const normalised = /^\d{10}$/.test(raw) ? `+91${raw}` : raw;

    try {
      const data = await api.post<AuthResponse>("/api/v1/auth/login", {
        phone: normalised,
        password,
      });

      if (data.user.role === "admin") {
        router.push("/admin/dashboard");
      } else if (data.communities.length === 1) {
        document.cookie = `community_id=${data.communities[0]!.id}; path=/; samesite=strict`;
        router.push("/dashboard/feed");
      } else {
        router.push("/");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      heading={<>Welcome Back 👋</>}
      bullets={["Access your private investment community.", "Your phone number must be pre-approved."]}
    >
      <div className="w-full max-w-md">
        <span className="flex items-center gap-1 text-sm font-semibold text-accent">
          <ChevronRight size={14} />
          Member Login
        </span>

        <h2 className="mt-2 font-display text-3xl font-bold text-primary">
          Login to your <span className="text-accent">Community</span>
        </h2>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
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
                onChange={(e) => changePhone(e.target.value)}
                onBlur={() => blurField("phone", phone)}
                className="w-full border-0 bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle focus:outline-none focus:ring-0"
              />
            </div>
            {errors.phone && (
              <p className="mt-1.5 text-xs text-red-500">{errors.phone}</p>
            )}
          </div>

          <div>
            <label className="text-sm font-semibold text-primary">Password</label>
            <div className="mt-2">
              <PasswordInput
                placeholder="Enter your password"
                value={password}
                onChange={(e) => changePassword(e.target.value)}
                onBlur={() => blurField("password", password)}
                hasError={!!errors.password}
              />
            </div>
            {errors.password ? (
              <p className="mt-1.5 text-xs text-red-500">{errors.password}</p>
            ) : (
              <div className="mt-2 text-right">
                <a href="#" className="text-sm font-semibold text-accent transition-colors hover:text-primary">
                  Forgot Password?
                </a>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary py-3 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Logging in…" : "Login to Community"}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-subtle">
          <Lock size={12} />
          Your details are never shared with other members
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 border-t border-divider pt-6">
          <span className="text-sm text-muted">Don&apos;t have an account?</span>
          <Link
            href="/signup"
            className="rounded-full border border-accent px-4 py-1.5 text-sm font-bold text-accent transition-all duration-300 hover:bg-accent/5 hover:shadow-card"
          >
            Sign up
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
