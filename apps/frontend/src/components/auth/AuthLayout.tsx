import { Activity, BarChart2, BarChart3, Navigation, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

type AuthLayoutProps = {
  heading: ReactNode;
  bullets: string[];
  children: ReactNode;
};

export default function AuthLayout({ heading, bullets, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Dark hero panel — hidden on mobile, full-height on desktop */}
      <div className="hidden lg:relative lg:flex lg:w-[49%] lg:flex-col lg:justify-between lg:gap-10 lg:overflow-hidden lg:bg-primary lg:p-16 lg:text-white">
        {/* Decorative outline icons scattered around the panel */}
        <Navigation className="pointer-events-none absolute right-[18%] top-[12%] h-9 w-9 -rotate-45 text-lime opacity-50" />
        <BarChart2 className="pointer-events-none absolute left-[14%] top-[34%] h-10 w-10 text-lime opacity-40" />
        <Activity className="pointer-events-none absolute right-[14%] top-[46%] h-9 w-9 text-lime opacity-45" />
        <TrendingUp className="pointer-events-none absolute bottom-[22%] left-[10%] h-9 w-9 text-lime opacity-40" />
        <BarChart3 className="pointer-events-none absolute bottom-[18%] right-[16%] h-10 w-10 text-lime opacity-45" />

        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Finskool" className="animate-rise relative h-16 w-16 rounded-full bg-white shadow-glow" />

        {/* Heading + bullets */}
        <div className="relative">
          <h1 className="animate-rise font-display text-5xl font-bold leading-tight xl:text-[68px] xl:leading-18.5 [animation-delay:100ms]">
            {heading}
          </h1>
          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((bullet, i) => (
              <li
                key={bullet}
                className="animate-rise flex items-start gap-2 text-base text-white/80"
                style={{ animationDelay: `${200 + i * 80}ms` }}
              >
                <span className="mt-1 shrink-0 text-white/80">•</span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm" style={{ color: "#5a8a80" }}>
          Your identity is always private
        </p>
      </div>

      {/* Right side — form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-6 sm:p-12 lg:p-16">
        {/* Mobile-only hero heading (no dark panel) */}
        <div className="mb-6 w-full max-w-md lg:hidden">
          <h1 className="font-display text-4xl font-bold leading-tight text-primary">
            {heading}
          </h1>
          <ul className="mt-3 flex flex-col gap-1.5">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-xs text-primary">
                <span className="mt-0.5 shrink-0">•</span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <div className="animate-rise flex w-full justify-center [animation-delay:150ms]">{children}</div>
      </div>
    </div>
  );
}
