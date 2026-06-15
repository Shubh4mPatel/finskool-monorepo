import { ArrowRight, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";

export default function LoginPage() {
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

        <div className="mt-8 flex flex-col gap-5">
          <div>
            <label className="text-sm font-semibold text-primary">Phone Number</label>
            <div className="mt-2 flex overflow-hidden rounded-xl border border-divider transition-colors focus-within:border-accent">
              <span className="flex items-center bg-primary px-4 text-sm font-semibold text-white">
                +91
              </span>
              <input
                type="tel"
                placeholder="Enter your phone number"
                className="w-full border-0 bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-primary">Password</label>
            <div className="mt-2">
              <PasswordInput placeholder="Enter your password" />
            </div>
            <div className="mt-2 text-right">
              <a href="#" className="text-sm font-semibold text-accent transition-colors hover:text-primary">
                Forgot Password?
              </a>
            </div>
          </div>

          <button className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary py-3 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98]">
            Login to Community
            <ArrowRight size={16} />
          </button>
        </div>

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
