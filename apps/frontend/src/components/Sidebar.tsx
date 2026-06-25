"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSession, clearSession, type SessionInfo } from "@/lib/session";
import {
  LayoutGrid,
  Megaphone,
  TrendingUp,
  BarChart3,
  MessagesSquare,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navItems = [
  { href: "/feed", label: "Feed", icon: LayoutGrid },
  { href: "/announcements", label: "Announcements", icon: Megaphone },
  { href: "/recommendations", label: "Recommendations", icon: TrendingUp },
  { href: "/stock-tracker", label: "Stock Tracker", icon: BarChart3 },
  { href: "/replies", label: "My Replies", icon: MessagesSquare },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  async function handleLogout() {
    try { await api.post("/api/v1/auth/logout", {}) } catch { /* ignore */ }
    clearSession();
    router.push("/login");
  }

  const displayName = session?.userName ?? "Member";
  const displayInitials = session?.userInitials ?? "M";
  const communityName = session?.communityName ?? "";

  return (
    <aside className="flex w-full flex-col gap-4 rounded-2xl bg-white p-4 shadow-card lg:h-fit lg:w-[269px] lg:gap-0 lg:p-6">
      <div className="flex items-center justify-between gap-3 lg:flex-col lg:justify-center lg:gap-3 lg:pb-6">
        <div className="flex items-center gap-3 lg:flex-col lg:gap-2">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-white ring-2 ring-primary/20 ring-offset-2 ring-offset-white lg:h-16 lg:w-16 lg:text-xl">
            {displayInitials}
          </div>
          <div className="flex items-center gap-2 lg:flex-col lg:gap-2">
            <p className="font-display font-bold text-primary">{displayName}</p>
            {communityName && (
              <span className="rounded-full bg-lime px-4 py-1 text-sm font-bold text-primary">
                {communityName}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-divider/60 lg:hidden"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <div className={`${open ? "block" : "hidden"} h-px w-full bg-divider lg:block`} />

      <nav className={`${open ? "flex" : "hidden"} flex-col gap-1 lg:flex lg:py-4 lg:pb-4`}>
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex w-full items-center gap-3 rounded-full px-4 py-3 text-base font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-primary text-white shadow-glow"
                  : "text-muted hover:translate-x-0.5 hover:bg-divider/60 hover:text-primary"
              }`}
            >
              <Icon size={18} />
              {item.label}
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
