import { AlertTriangle, ArrowRight, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";

export default function SignupPage() {
  return (
    <AuthLayout
      heading="Create Your Account"
      bullets={["Your phone number must be on the approved list.", "Enter your details to create your account."]}
    >
      <div className="w-full max-w-md">
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>This phone number is not on the access list. Please contact your admin.</span>
        </div>

        <span className="mt-4 flex items-center gap-1 text-sm font-semibold text-accent">
          <ChevronRight size={14} />
          Invitation Only
        </span>

        <div className="mt-6 flex flex-col gap-5">
          <div>
            <label className="text-sm font-semibold text-primary">Full Name</label>
            <input
              type="text"
              placeholder="Enter your full name"
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
              className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-primary">Set Password</label>
              <div className="mt-2">
                <PasswordInput />
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-primary">Confirm Password</label>
              <div className="mt-2">
                <PasswordInput />
              </div>
            </div>
          </div>

          <button className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary py-3 text-sm font-bold text-white">
            Create My Account
            <ArrowRight size={16} />
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-subtle">
          <Lock size={12} />
          Your personal details are never visible to other members
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 border-t border-divider pt-6">
          <span className="text-sm text-muted">Already registered?</span>
          <Link
            href="/login"
            className="rounded-full border border-accent px-4 py-1.5 text-sm font-bold text-accent"
          >
            Login
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
