import { ArrowRight, Bell, Lock, Users } from "lucide-react";
import Link from "next/link";

type CommunityCardProps = {
  membersCount: number;
  category: string;
  highlight: string;
  title: string;
  description: string;
  tags: string[];
  active?: boolean;
};

function CommunityCard({
  membersCount,
  category,
  highlight,
  title,
  description,
  tags,
  active,
}: CommunityCardProps) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-card-hover">
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-primary via-primary to-accent">
        <div
          className="absolute inset-0 opacity-20 transition-transform duration-700 group-hover:scale-110"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(193,242,110,0.9) 1.5px, transparent 1.5px)",
            backgroundSize: "18px 18px",
          }}
        />
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-lime/20 blur-2xl transition-transform duration-700 group-hover:scale-125" />
        <span className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-primary/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          <Users size={14} />
          {membersCount} Members
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6 text-left">
        <span className="text-sm font-semibold text-accent">{category}</span>
        <h2 className="mt-1 font-display text-2xl font-bold text-primary">
          {highlight} <span className="text-accent">{title}</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-muted"
            >
              {tag}
            </span>
          ))}
        </div>

        <Link
          href="/feed"
          className={`mt-6 flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
            active
              ? "bg-gradient-to-r from-accent to-primary text-white shadow-glow"
              : "border border-accent bg-white text-accent hover:bg-accent/5"
          }`}
        >
          Enter Community
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

export default function CommunitySelectorPage() {
  return (
    <div className="relative isolate flex min-h-screen w-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-lime/30 blur-3xl animate-float" />
      <div
        className="pointer-events-none absolute -right-40 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/15 blur-3xl animate-float"
        style={{ animationDelay: "-3s" }}
      />

      <div className="relative mx-auto flex w-full max-w-[1512px] flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center justify-between">
          <div className="font-display text-xl font-bold tracking-tight text-primary">Finskool</div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">Welcome back</span>
            <div className="flex h-9.5 w-9.5 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-background">
              RK
            </div>
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover">
              <Bell size={15} className="text-muted" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <span className="animate-rise flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-accent shadow-card">
            <Lock size={14} />
            Select Community
          </span>

          <h1 className="animate-rise mt-6 font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl lg:text-5xl [animation-delay:120ms]">
            Where would you like to go{" "}
            <span className="bg-gradient-to-r from-accent to-lime bg-clip-text text-transparent">
              today?
            </span>
          </h1>

          <p className="animate-rise mt-4 max-w-xl text-base text-muted [animation-delay:220ms]">
            You have access to both communities. Each community has completely separate content.
          </p>

          <div className="animate-rise mt-12 grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2 [animation-delay:320ms]">
            <CommunityCard
              membersCount={248}
              category="Long-term Investing"
              highlight="Investor"
              title="Community"
              description="Research reports, portfolio ideas, fundamental analysis and long-term stock picks"
              tags={["Research", "Portfolio", "Long-term"]}
            />
            <CommunityCard
              membersCount={312}
              category="Short-term Trading"
              highlight="Swing Alpha"
              title="Community"
              description="Live trade alerts, swing setups, entry & exit levels and weekly performance calls"
              tags={["Trade Alerts", "Swing Calls", "Live Updates"]}
              active
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-xl items-start justify-center gap-2 pb-4 text-center text-xs text-subtle">
          <Lock size={12} className="mt-0.5 shrink-0" />
          <span>
            You only see content from the community you enter. Communities are completely private from each other.
          </span>
        </div>
      </div>
    </div>
  );
}
