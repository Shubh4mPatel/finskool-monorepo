"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Lock, Smartphone } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError } from "@/lib/api";
import { saveSession, clearSession, initials } from "@/lib/session";
import { useToast } from "@/components/ui/Toast";

interface AuthResponse {
  user: { id: string; name: string; role: string; isSuperAdmin: boolean; avatarUrl?: string | null };
}

type FieldErrors = { email?: string; password?: string };

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address";
}

function validatePassword(value: string): string | undefined {
  if (!value) return "Password is required";
}

// Members use the mobile app; this site is for admins only.
function MobileOnlyNotice() {
  return (
    <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Smartphone size={18} />
      </span>
      <div>
        <p className="text-sm font-bold text-primary">This website is for admins only</p>
        <p className="mt-0.5 text-sm text-muted">Members, please log in from the Finskool mobile app.</p>
      </div>
    </div>
  );
}

export default function LoginForm({ initialAdminOnly = false }: { initialAdminOnly?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [adminOnly, setAdminOnly] = useState(initialAdminOnly);

  function blurField(field: keyof FieldErrors, value: string) {
    setTouched((t) => ({ ...t, [field]: true }));
    const msg = field === "email" ? validateEmail(value) : validatePassword(value);
    setErrors((e) => ({ ...e, [field]: msg }));
  }

  function changeEmail(value: string) {
    setEmail(value);
    if (touched.email) setErrors((e) => ({ ...e, email: validateEmail(value) }));
  }

  function changePassword(value: string) {
    setPassword(value);
    if (touched.password) setErrors((e) => ({ ...e, password: validatePassword(value) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);
    setTouched({ email: true, password: true });
    setErrors({ email: emailErr, password: passwordErr });
    if (emailErr || passwordErr) return;

    setAdminOnly(false);
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>("/api/v1/auth/login", {
        email: email.trim().toLowerCase(),
        password,
      });

      // The API already refuses members; this is a backstop so a member is never left with a web session.
      if (data.user.role !== "admin") {
        await api.post("/api/v1/auth/logout", {}).catch(() => {});
        clearSession();
        setAdminOnly(true);
        return;
      }

      saveSession({ userId: data.user.id, userName: data.user.name, userInitials: initials(data.user.name), communityName: "", communityId: "", avatarUrl: data.user.avatarUrl ?? null, role: data.user.role, isSuperAdmin: data.user.isSuperAdmin });
      router.push("/admin/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ADMIN_ONLY") {
        setAdminOnly(true);
      } else if (err instanceof ApiError && err.code === "NOT_REGISTERED") {
        toast.error({ title: "Account not set up", message: err.message });
      } else {
        toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      heading={<>Welcome Back 👋</>}
      bullets={["Manage your communities, members and content.", "Admin accounts only."]}
    >
      <div className="w-full max-w-md">
        {/* White card */}
        <div className="rounded-2xl bg-white px-10 py-10 shadow-card">
          <span className="flex items-center gap-1 text-sm font-semibold text-accent">
            <ChevronRight size={14} />
            Admin Sign-in
          </span>

          <h2 className="mt-3 font-display text-3xl font-bold text-primary">
            Sign in to the <br />
            <span className="text-[#85cd78]">Admin Console</span>
          </h2>

          {adminOnly && <MobileOnlyNotice />}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
            <div>
              <label className="text-sm font-semibold text-primary">Email Address</label>
              <input
                type="email"
                placeholder="Enter your e mail address"
                value={email}
                onChange={(e) => changeEmail(e.target.value)}
                onBlur={() => blurField("email", email)}
                className={`mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm text-primary placeholder:text-[#b0aba1] transition-colors focus:outline-none focus:border-accent ${
                  errors.email ? "border-red-400" : "border-[#d6d2c8]"
                }`}
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-500">{errors.email}</p>
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
              {errors.password && (
                <p className="mt-1.5 text-xs text-red-500">{errors.password}</p>
              )}
              <div className="mt-2 text-right">
                <a href="#" className="text-sm font-semibold text-accent transition-colors hover:text-primary">
                  Forgot Password?
                </a>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex items-center justify-center gap-2 rounded-full py-4 px-8 text-sm font-bold text-white transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
            >
              {loading ? "Signing in…" : "Sign in"}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <hr className="mt-6 border-divider" />

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-subtle">
            <Lock size={12} />
            Admin access only
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
