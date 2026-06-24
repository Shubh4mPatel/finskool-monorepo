import { BarChart3, Check, Lock, Send } from "lucide-react";
import type { ReactNode } from "react";

type AuthLayoutProps = {
  heading: ReactNode;
  bullets: string[];
  children: ReactNode;
};

export default function AuthLayout({ heading, bullets, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="relative flex flex-col justify-between gap-10 overflow-hidden bg-primary p-8 text-white sm:p-12 lg:w-1/2 lg:p-16">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-lime/20 blur-3xl animate-float" />
        <div
          className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-accent/30 blur-3xl animate-float"
          style={{ animationDelay: "-3.5s" }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <Send className="absolute right-16 top-16 h-8 w-8 -rotate-45 text-white/10" />
        <BarChart3 className="absolute bottom-24 right-12 h-10 w-10 text-white/10" />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Finskool" className="animate-rise relative h-16 w-16 rounded-full bg-white shadow-glow" />

        <div className="relative">
          <h1 className="animate-rise font-display text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl [animation-delay:100ms]">
            {heading}
          </h1>
          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((bullet, i) => (
              <li
                key={bullet}
                className="animate-rise flex items-center gap-2 text-sm text-white/80 sm:text-base"
                style={{ animationDelay: `${200 + i * 80}ms` }}
              >
                <Check size={16} className="shrink-0 text-lime" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-sm text-white/60">
          <Lock size={14} />
          Your identity is always private
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-background p-6 sm:p-12 lg:p-16">
        <div className="animate-rise flex w-full justify-center [animation-delay:150ms]">{children}</div>
      </div>
    </div>
  );
}
