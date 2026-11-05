"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, KeyRound, Lock } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Step = "email" | "code" | "password";

const RESEND_SECONDS = 60;
const inputClass = (hasError: boolean) =>
  `mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm text-primary placeholder:text-[#b0aba1] transition-colors focus:outline-none focus:border-accent ${
    hasError ? "border-red-400" : "border-[#d6d2c8]"
  }`;
const buttonStyle = { background: "linear-gradient(to right, #c1f26e, #108b8b)" };
const buttonClass =
  "mt-1 flex items-center justify-center gap-2 rounded-full py-4 px-8 text-sm font-bold text-white transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address";
}

const STEP_TEXT: Record<Step, { eyebrow: string; title: React.ReactNode; hint: string }> = {
  email: {
    eyebrow: "Forgot password",
    title: (
      <>
        Reset your <br />
        <span className="text-[#85cd78]">password</span>
      </>
    ),
    hint: "Enter the email you sign in with and we'll send you a 6-digit code.",
  },
  code: {
    eyebrow: "Check your email",
    title: (
      <>
        Enter the <br />
        <span className="text-[#85cd78]">code</span>
      </>
    ),
    hint: "",
  },
  password: {
    eyebrow: "Almost done",
    title: (
      <>
        Choose a new <br />
        <span className="text-[#85cd78]">password</span>
      </>
    ),
    hint: "Use at least 8 characters. You'll be signed out everywhere and asked to sign in again.",
  },
};

export default function ForgotPasswordForm() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [cypher, setCypher] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function startOver(message?: string) {
    setStep("email");
    setOtp("");
    setCypher("");
    setNewPassword("");
    setConfirmPassword("");
    setError(message);
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);

    setError(undefined);
    setLoading(true);
    try {
      await api.post("/api/v1/auth/forgot-password", { email: email.trim().toLowerCase() });
      setStep("code");
      setOtp("");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError("Enter the 6-digit code from your email");

    setError(undefined);
    setLoading(true);
    try {
      const data = await api.post<{ cypher: string }>("/api/v1/auth/forgot-password/verify-otp", {
        email: email.trim().toLowerCase(),
        otp,
      });
      setCypher(data.cypher);
      setStep("password");
    } catch (err) {
      if (err instanceof ApiError && err.code === "OTP_LOCKED") {
        startOver(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) return setError("Password must be at least 8 characters");
    if (newPassword !== confirmPassword) return setError("Passwords do not match");

    setError(undefined);
    setLoading(true);
    try {
      await api.post("/api/v1/auth/forgot-password/reset", {
        cypher,
        newPassword,
        confirmNewPassword: confirmPassword,
      });
      toast.success({ title: "Password updated", message: "Sign in with your new password." });
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError && err.code === "RESET_TOKEN_INVALID") {
        startOver("This reset session has expired. Please start again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  const text = STEP_TEXT[step];

  return (
    <AuthLayout
      heading={<>Forgot your password? 🔑</>}
      bullets={["We'll email a one-time code to your admin address.", "Admin accounts only."]}
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white px-10 py-10 shadow-card">
          <span className="flex items-center gap-1 text-sm font-semibold text-accent">
            <ChevronRight size={14} />
            {text.eyebrow}
          </span>

          <h2 className="mt-3 font-display text-3xl font-bold text-primary">{text.title}</h2>

          {step === "code" ? (
            <p className="mt-3 text-sm text-muted">
              If <strong className="text-primary">{email.trim().toLowerCase()}</strong> belongs to an admin account, we&apos;ve sent a
              6-digit code. It expires in 10 minutes.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">{text.hint}</p>
          )}

          {step === "email" && (
            <form onSubmit={sendCode} className="mt-6 flex flex-col gap-5" noValidate>
              <div>
                <label className="text-sm font-semibold text-primary">Email Address</label>
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="Enter your e mail address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(undefined);
                  }}
                  className={inputClass(!!error)}
                />
                {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
              </div>
              <button type="submit" disabled={loading} className={buttonClass} style={buttonStyle}>
                {loading ? "Sending…" : "Send code"}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verifyCode} className="mt-6 flex flex-col gap-5" noValidate>
              <div>
                <label className="text-sm font-semibold text-primary">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(undefined);
                  }}
                  className={`${inputClass(!!error)} text-center font-display text-xl tracking-[0.5em]`}
                />
                {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
              </div>
              <button type="submit" disabled={loading} className={buttonClass} style={buttonStyle}>
                {loading ? "Checking…" : "Verify code"}
                {!loading && <KeyRound size={16} />}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => startOver()}
                  className="flex items-center gap-1 font-semibold text-accent transition-colors hover:text-primary"
                >
                  <ArrowLeft size={14} />
                  Change email
                </button>
                <button
                  type="button"
                  disabled={resendIn > 0 || loading}
                  onClick={() => sendCode()}
                  className="font-semibold text-accent transition-colors hover:text-primary disabled:cursor-not-allowed disabled:text-subtle"
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={resetPassword} className="mt-6 flex flex-col gap-5" noValidate>
              <div>
                <label className="text-sm font-semibold text-primary">New password</label>
                <div className="mt-2">
                  <PasswordInput
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setError(undefined);
                    }}
                    hasError={!!error}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Confirm new password</label>
                <div className="mt-2">
                  <PasswordInput
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError(undefined);
                    }}
                    hasError={!!error}
                  />
                </div>
                {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
              </div>
              <button type="submit" disabled={loading} className={buttonClass} style={buttonStyle}>
                {loading ? "Saving…" : "Reset password"}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          <hr className="mt-6 border-divider" />

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-subtle">
            <Lock size={12} />
            <Link href="/login" className="font-semibold text-accent transition-colors hover:text-primary">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
