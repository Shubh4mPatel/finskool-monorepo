"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSession, clearSession, type SessionInfo } from "@/lib/session";
import {
  ArrowLeft,
  LayoutGrid,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  TrendingUp,
  X,
} from "lucide-react";

const navItems = [
  { href: "/feed", label: "Feed", icon: LayoutGrid, count: 20 },
  { href: "/announcements", label: "Announcements", icon: Megaphone, count: null },
  { href: "/recommendations", label: "Recommendations", icon: TrendingUp, count: 10 },
  { href: "/replies", label: "My Threads", icon: MessagesSquare, count: null },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .get<{ count: number }>("/api/v1/notifications/unread-count")
        .then((d) => setUnreadCount(d.count))
        .catch(() => {});
    load();
    const interval = setInterval(load, 45_000);
    window.addEventListener("notifications:updated", load);
    return () => {
      clearInterval(interval);
      window.removeEventListener("notifications:updated", load);
    };
  }, []);

  async function handleLogout() {
    try { await api.post("/api/v1/auth/logout", {}) } catch { /* ignore */ }
    clearSession();
    router.push("/login");
  }

  const displayName = session?.userName ?? "Member";
  const displayInitials = session?.userInitials ?? "M";
  const communityName = session?.communityName ?? "";
  const avatarUrl = session?.avatarUrl ?? null;

  // Re-read session when profile is updated (e.g. avatar change)
  useEffect(() => {
    const onUpdate = () => setSession(getSession());
    window.addEventListener("profile:updated", onUpdate);
    return () => window.removeEventListener("profile:updated", onUpdate);
  }, []);

  return (
    <aside className="flex w-full flex-col gap-4 rounded-2xl bg-white p-4 shadow-card lg:sticky lg:top-8 lg:self-start lg:w-67.25 lg:gap-0 lg:p-6">
      {/* Desktop header: back arrow + centered avatar / name / chip */}
      <div className="hidden pb-5 lg:flex lg:flex-col">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/80"
          aria-label="Go back"
        >
          <ArrowLeft size={15} />
        </button>
        <Link href="/profile" className="mt-4 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-white ring-2 ring-primary/20 ring-offset-2 ring-offset-white transition-transform hover:scale-105 overflow-hidden">
            {avatarUrl
              ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
              : displayInitials
            }
          </div>
          <p className="font-semibold text-primary">{displayName}</p>
          {communityName && (
            <span className="flex items-center gap-1 rounded-full border border-lime bg-lime/10 px-4 py-1 text-xs font-semibold text-primary">
              ⚡ {communityName}
            </span>
          )}
        </Link>
      </div>

      {/* Mobile header: hamburger + community chip + avatar */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-divider/60"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        {communityName && (
          <span className="flex items-center gap-1 rounded-full border border-lime bg-lime/10 px-4 py-1 text-sm font-semibold text-primary">
            ⚡ {communityName}
          </span>
        )}
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white overflow-hidden"
        >
          {avatarUrl
            ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            : displayInitials
          }
        </Link>
      </div>

      <div className={`${open ? "block" : "hidden"} h-px w-full bg-divider lg:block`} />

      <nav className={`${open ? "flex" : "hidden"} flex-col gap-1 lg:flex lg:py-4 lg:pb-4`}>
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
          const count = item.href === "/announcements" ? unreadCount : item.count;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 text-base font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-primary text-white shadow-glow"
                  : "text-muted hover:translate-x-0.5 hover:bg-divider/60 hover:text-primary"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon size={18} />
                {item.label}
              </span>
              {count !== null && count > 0 && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  isActive ? "bg-white/25 text-white" : "bg-primary/10 text-primary"
                }`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={`${open ? "block" : "hidden"} h-px w-full bg-divider lg:block`} />

      <button
        onClick={() => { setOpen(false); handleLogout(); }}
        className={`${open ? "flex" : "hidden"} items-center gap-2 self-start rounded-full px-3.5 py-1.5 text-sm font-semibold text-subtle transition-colors hover:bg-divider/60 hover:text-primary lg:flex lg:mt-4`}
      >
        <LogOut size={14} />
        Logout
      </button>
    </aside>
  );
}
