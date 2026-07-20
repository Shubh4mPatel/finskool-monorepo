"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clearSession, getSession, type SessionInfo } from "@/lib/session";
import {
  LayoutDashboard,
  Pencil,
  LayoutGrid,
  List,
  MessagesSquare,
  Users,
  Upload,
  TrendingUp,
  ShieldCheck,
  Building2,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/create-post", label: "Create Post", icon: Pencil },
  { href: "/admin/feed", label: "Feed", icon: LayoutGrid },
  { href: "/admin/all-posts", label: "All Posts", icon: List },
  { href: "/admin/unresolved-threads", label: "Unreplied Threads", icon: MessagesSquare, badge: undefined as number | undefined },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/import-csv", label: "Import CSV", icon: Upload },
  { href: "/admin/stock-recommendations", label: "Stock Recommendation", icon: TrendingUp },
  { href: "/admin/roles-admins", label: "Roles & Admins", icon: ShieldCheck },
  { href: "/admin/communities", label: "Communities", icon: Building2, superAdminOnly: true },
];

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unresolvedThreads, setUnresolvedThreads] = useState<number | undefined>(undefined);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    setSession(getSession());
    const onUpdate = () => setSession(getSession());
    window.addEventListener("profile:updated", onUpdate);
    return () => window.removeEventListener("profile:updated", onUpdate);
  }, []);

  useEffect(() => {
    api
      .get<{ stats: { unresolvedThreads: number } }>("/api/v1/admin/dashboard")
      .then((data) => setUnresolvedThreads(data.stats.unresolvedThreads))
      .catch(() => {});
  }, []);

  const displayName = session?.userName ?? "Admin";
  const displayInitials = session?.userInitials ?? "A";
  const avatarUrl = session?.avatarUrl ?? null;

  async function handleLogout() {
    try { await api.post("/api/v1/auth/logout", {}) } catch { /* ignore */ }
    clearSession();
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Profile */}
      <div className="flex flex-col items-center gap-2 px-4 py-6">
        <Link href="/admin/profile" onClick={onNav} className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-primary text-base font-bold text-white transition-transform hover:scale-105">
          {avatarUrl
            ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            : displayInitials
          }
        </Link>
        <p className="text-sm font-bold text-primary">{displayName}</p>
        <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-bold text-primary">
          {session?.isSuperAdmin ? "Super Admin" : "Admin"}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {navItems.filter((item) => !item.superAdminOnly || session?.isSuperAdmin).map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
          const badge = item.href === "/admin/unresolved-threads" ? unresolvedThreads : item.badge;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-divider hover:text-primary"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon size={15} />
                {item.label}
              </span>
              {badge != null && badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-divider px-3 py-3">
        <button
          onClick={() => { onNav?.(); handleLogout(); }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-subtle transition-colors hover:bg-divider hover:text-primary"
        >
          <LogOut size={15} />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside className="hidden h-full w-64 shrink-0 overflow-hidden rounded-2xl bg-white shadow-card lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden">
        <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-divider bg-white px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Finskool" className="h-7 w-7" />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-divider"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-48 border-r border-divider bg-white shadow-card-hover">
              <SidebarContent onNav={() => setMobileOpen(false)} />
            </aside>
          </>
        )}
      </div>
    </>
  );
}
