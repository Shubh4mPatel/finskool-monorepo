"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/create-post", label: "Create Post", icon: Pencil },
  { href: "/admin/feed", label: "Feed", icon: LayoutGrid, badge: 1 },
  { href: "/admin/all-posts", label: "All Posts", icon: List, badge: 1 },
  { href: "/admin/unresolved-threads", label: "Unreplied Threads", icon: MessagesSquare, badge: 7 },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/import-csv", label: "Import CSV", icon: Upload },
  { href: "/admin/stock-recommendations", label: "Stock Recommendation", icon: TrendingUp },
  { href: "/admin/roles-admins", label: "Roles & Admins", icon: ShieldCheck },
];

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Profile */}
      <div className="flex flex-col items-center gap-2 px-4 py-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-base font-bold text-white">
          RK
        </div>
        <p className="text-sm font-bold text-primary">Ritesh Kumar</p>
        <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-bold text-primary">
          Super Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
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
              {item.badge != null && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-divider px-3 py-3">
        <Link
          href="/login"
          onClick={onNav}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-subtle transition-colors hover:bg-divider hover:text-primary"
        >
          <LogOut size={15} />
          Logout
        </Link>
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
          <span className="text-sm font-bold text-primary">Finskool</span>
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
