"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, Lock } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface Community {
  id: string;
  name: string;
  slug: string;
}

interface MeResponse {
  user: { id: string; name: string; role: string; avatarUrl: string | null };
  communities: Community[];
}

type CommunityCardProps = {
  community: Community;
  active?: boolean;
  onSelect: (id: string) => void;
};

function CommunityCard({ community, active, onSelect }: CommunityCardProps) {
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
      </div>

      <div className="flex flex-1 flex-col p-6 text-left">
        <h2 className="font-display text-2xl font-bold text-primary">{community.name}</h2>

        <button
          onClick={() => onSelect(community.id)}
          className={`mt-6 flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
            active
              ? "bg-gradient-to-r from-accent to-primary text-white shadow-glow"
              : "border border-accent bg-white text-accent hover:bg-accent/5"
          }`}
        >
          Enter Community
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}

export default function CommunitySelectorPage() {
  const router = useRouter();
  const [meData, setMeData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MeResponse>("/api/v1/auth/me")
      .then(setMeData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
        } else {
          setError("Failed to load communities. Please refresh.");
        }
      });
  }, [router]);

  function handleSelect(communityId: string) {
    document.cookie = `community_id=${communityId}; path=/; samesite=strict`;
    router.push("/dashboard/feed");
  }

  const initials = meData?.user.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() ?? "…";

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
            {meData && (
              <span className="hidden text-sm text-muted sm:inline">
                Welcome back, {meData.user.name.split(" ")[0]}
              </span>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-background">
              {initials}
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

          {meData && meData.communities.length > 1 && (
            <p className="animate-rise mt-4 max-w-xl text-base text-muted [animation-delay:220ms]">
              You have access to {meData.communities.length} communities. Each community has completely separate content.
            </p>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-500">{error}</p>
          )}

          {!meData && !error && (
            <p className="mt-8 text-sm text-muted">Loading your communities…</p>
          )}

          {meData && (
            <div className="animate-rise mt-12 grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2 [animation-delay:320ms]">
              {meData.communities.map((community, i) => (
                <CommunityCard
                  key={community.id}
                  community={community}
                  active={i === 0}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
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
