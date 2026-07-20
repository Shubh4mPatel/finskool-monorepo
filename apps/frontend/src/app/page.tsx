"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Lock, LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { clearSession, updateSessionCommunity } from "@/lib/session";

interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  memberCount: number;
}

interface MeResponse {
  user: { id: string; name: string; role: string; avatarUrl: string | null };
  communities: Community[];
}

const COMMUNITY_META: Record<string, { category: string; chips: string[] }> = {
  "investor-community": {
    category: "Long-term Investing",
    chips: ["Research", "Portfolio", "Long-term"],
  },
  "swing-alpha": {
    category: "Short-term Trading",
    chips: ["Trade Alerts", "Swing Calls", "Live Updates"],
  },
};

type CommunityCardProps = {
  community: Community;
  onSelect: (id: string) => void;
};

function CommunityCard({ community, onSelect }: CommunityCardProps) {
  const meta = COMMUNITY_META[community.slug];

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-card-hover">
      <div className="relative h-58 overflow-hidden bg-linear-to-br from-primary via-primary to-accent">
        {community.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={community.coverImageUrl}
            alt={community.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <>
            <div
              className="absolute inset-0 opacity-20 transition-transform duration-700 group-hover:scale-110"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(193,242,110,0.9) 1.5px, transparent 1.5px)",
                backgroundSize: "18px 18px",
              }}
            />
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-lime/20 blur-2xl transition-transform duration-700 group-hover:scale-125" />
          </>
        )}
        <span className="absolute bottom-3 left-3 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
          {community.memberCount} {community.memberCount === 1 ? "Member" : "Members"}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6 text-left">
        {meta && (
          <span className="text-xs font-semibold tracking-wide text-accent">{meta.category}</span>
        )}
        <h2 className="mt-1 font-display text-2xl font-bold text-black">{community.name}</h2>
        {community.description && (
          <p className="mt-2 text-sm leading-relaxed text-black">{community.description}</p>
        )}

        {meta && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary"
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => onSelect(community.id)}
          className="mt-6 flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
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

  async function handleSelect(communityId: string) {
    try {
      await api.post("/api/v1/auth/select-community", { communityId });
      const comm = meData?.communities.find(c => c.id === communityId);
      if (comm) updateSessionCommunity(communityId, comm.name);
      router.push("/feed");
    } catch {
      setError("Failed to select community. Please try again.");
    }
  }

  function handleLogout() {
    clearSession();
    router.push("/login");
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
        className="pointer-events-none absolute -right-40 top-1/3 h-112 w-md rounded-full bg-accent/15 blur-3xl animate-float"
        style={{ animationDelay: "-3s" }}
      />

      <div className="relative mx-auto flex w-full max-w-378 flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Finskool" className="h-9 w-9" />

          <div className="flex items-center gap-3">
            {meData && (
              <span className="text-xs text-muted sm:text-sm">
                Welcome back, {meData.user.name.split(" ")[0]}
              </span>
            )}
            {meData?.user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={meData.user.avatarUrl}
                alt={meData.user.name}
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-br from-accent to-primary text-sm font-bold text-lime">
                {initials}
              </div>
            )}
            <button
              onClick={handleLogout}
              aria-label="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d6d2c8] bg-white text-muted transition-colors hover:text-accent"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-12 text-left sm:text-center">
          <span className="animate-rise flex items-center gap-1 self-start text-sm font-semibold text-accent sm:self-center">
            <ChevronRight size={14} />
            Select Community
          </span>

          <h1 className="animate-rise mt-3 font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl lg:text-[44px] [animation-delay:120ms]">
            Where would you like to go{" "}
            <span className="bg-linear-to-r from-accent to-lime bg-clip-text text-transparent">
              today?
            </span>
          </h1>

          {meData && meData.communities.length > 1 && (
            <p className="animate-rise mt-4 max-w-xl text-sm text-primary sm:text-base [animation-delay:220ms]">
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
              {meData.communities.map((community) => (
                <CommunityCard
                  key={community.id}
                  community={community}
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
