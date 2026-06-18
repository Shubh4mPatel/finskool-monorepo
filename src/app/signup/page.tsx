"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError } from "@/lib/api";

interface AuthResponse {
  user: { id: string; name: string; role: string };
  communities: { id: string; name: string; slug: string }[];
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

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
        document.cookie = `community_id=${data.communities[0]!.id}; path=/; samesite=strict`;
        router.push("/dashboard/feed");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      heading="Create Your Account"
      bullets={["Your phone number must be on the approved list.", "Enter your details to create your account."]}
    >
      <div className="w-full max-w-md">
        {error && (
          <div className="animate-rise flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <span className="mt-4 flex items-center gap-1 text-sm font-semibold text-accent">
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
              onChange={(e) => setFullName(e.target.value)}
              required
              className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-primary">Phone Number</label>
            <div className="mt-2 flex overflow-hidden rounded-xl border border-divider transition-colors focus-within:border-accent">
              <span className="flex items-center bg-primary px-4 text-sm font-semibold text-white">
                +91
              </span>
              <input
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full border-0 bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle focus:outline-none focus:ring-0"
              />
            </div>
            <p className="mt-1 text-xs text-subtle">Must match the number your admin registered for you</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-primary">Email Address</label>
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-primary">Set Password</label>
              <div className="mt-2">
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Confirm Password</label>
              <div className="mt-2">
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
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
