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
  { href: "/admin/feed", label: "Feed", icon: LayoutGrid, badge: 3 },
  { href: "/admin/all-posts", label: "All Posts", icon: List, badge: 3 },
  { href: "/admin/unresolved-threads", label: "Unresolved Threads", icon: MessagesSquare, badge: 7 },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/import-csv", label: "Import CSV", icon: Upload },
  { href: "/admin/stock-recommendations", label: "Stock Recommendation", icon: TrendingUp },
  { href: "/admin/roles-admins", label: "Roles & Admins", icon: ShieldCheck },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="flex w-full flex-col gap-4 rounded-2xl bg-white p-4 shadow-card lg:h-fit lg:w-[280px] lg:gap-0 lg:p-6">
      <div className="flex items-center justify-between gap-3 lg:flex-col lg:justify-center lg:gap-3 lg:pb-6">
        <div className="flex items-center gap-3 lg:flex-col lg:gap-2">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-lg font-bold text-lime ring-2 ring-lime/50 ring-offset-2 ring-offset-white lg:h-16 lg:w-16 lg:text-xl">
            RK
          </div>
          <div className="flex items-center gap-2 lg:flex-col lg:gap-2 lg:text-center">
            <p className="font-display font-bold text-primary">Ritesh Kumar</p>
            <span className="rounded-full bg-lime px-4 py-1 text-sm font-bold text-primary">
              Super Admin
            </span>
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

      <nav className={`${open ? "flex" : "hidden"} flex-col gap-0.5 lg:flex lg:py-4 lg:pb-4`}>
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex w-full items-center justify-between gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-primary text-white shadow-glow"
                  : "text-muted hover:translate-x-0.5 hover:bg-divider/60 hover:text-primary"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon size={16} />
                {item.label}
              </span>
              {item.badge != null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    isActive ? "bg-white/20" : "bg-primary/10 text-primary"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={`${open ? "block" : "hidden"} h-px w-full bg-divider lg:block`} />

      <Link
        href="/login"
        onClick={() => setOpen(false)}
        className={`${open ? "flex" : "hidden"} items-center gap-2 self-start rounded-full px-3.5 py-1.5 text-sm font-semibold text-subtle transition-colors hover:bg-divider/60 hover:text-primary lg:flex lg:mt-4`}
      >
        <LogOut size={14} />
        Logout
      </Link>
    </aside>
  );
}
