"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { clearSession, useSession, type SessionInfo } from "@/lib/session";
import { notificationSocketStore } from "@/store/notifications/notificationSocketStore";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import {
  LayoutDashboard,
  Pencil,
  LayoutGrid,
  List,
  Users,
  Upload,
  TrendingUp,
  ShieldCheck,
  Building2,
  Gift,
  Bell,
  LifeBuoy,
  Briefcase,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

type BadgeKey = "notifications" | "tickets" | "services";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: BadgeKey;
  superAdminOnly?: boolean;
}

// Grouped the way admins think about the work, rather than one long flat list.
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/notifications", label: "Notifications", icon: Bell, badge: "notifications" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/create-post", label: "Create Post", icon: Pencil },
      { href: "/admin/feed", label: "Feed", icon: LayoutGrid },
      { href: "/admin/all-posts", label: "All Posts", icon: List },
      { href: "/admin/stock-recommendations", label: "Stock Recommendation", icon: TrendingUp },
      { href: "/admin/welcome-kit", label: "Welcome Kit", icon: Gift },
    ],
  },
  {
    label: "Members",
    items: [
      { href: "/admin/members", label: "Members", icon: Users },
      { href: "/admin/import-csv", label: "Import CSV", icon: Upload },
    ],
  },
  {
    label: "Support",
    items: [
      { href: "/admin/tickets", label: "Support Tickets", icon: LifeBuoy, badge: "tickets" },
      { href: "/admin/services", label: "Services", icon: Briefcase, badge: "services" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/communities", label: "Communities", icon: Building2, superAdminOnly: true },
      { href: "/admin/roles-admins", label: "Roles & Admins", icon: ShieldCheck, superAdminOnly: true },
    ],
  },
];

// ─── Collapsed-rail preference (desktop only) ───────────────────────────────
// Kept in localStorage so it survives reloads; a tiny external store so the server render
// (always expanded) and the client agree without a setState-in-effect flash.

const COLLAPSED_KEY = "finskool_admin_sidebar_collapsed";
const collapsedListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* private mode / storage blocked — the toggle still works for this page view */
  }
  collapsedListeners.forEach(l => l());
}

function useCollapsed(): boolean {
  return useSyncExternalStore(
    cb => {
      collapsedListeners.add(cb);
      return () => collapsedListeners.delete(cb);
    },
    readCollapsed,
    () => false,
  );
}

const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/admin/dashboard" className="flex min-w-0 items-center gap-3" aria-label="Finskool admin home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="h-10 w-10 shrink-0" />
      {!collapsed && (
        <span className="min-w-0">
          <span className="block font-display text-base font-bold leading-tight tracking-tight text-primary">Finskool</span>
          <span className="block text-[11px] font-semibold text-muted">Admin console</span>
        </span>
      )}
    </Link>
  );
}

interface SidebarData {
  session: SessionInfo | null;
  badges: Record<BadgeKey, number | undefined>;
}

/**
 * Session + live badge counts. Called once by AdminSidebar and shared by the desktop rail and the
 * mobile drawer, so polling and socket subscriptions never run twice.
 */
function useSidebarData(): SidebarData {
  const [unreadNotifications, setUnreadNotifications] = useState<number | undefined>(undefined);
  const [ticketsNeedingAttention, setTicketsNeedingAttention] = useState<number | undefined>(undefined);
  const [servicesNeedingAttention, setServicesNeedingAttention] = useState<number | undefined>(undefined);
  const session = useSession();

  useEffect(() => {
    const load = () =>
      api
        .get<{ count: number }>("/api/v1/notifications/unread-count")
        .then((d) => setUnreadNotifications(d.count))
        .catch(() => {});
    load();
    const interval = setInterval(load, 45_000);
    window.addEventListener("notifications:updated", load);

    notificationSocketStore.connect();
    const unsubscribe = notificationSocketStore.subscribe(load);

    return () => {
      clearInterval(interval);
      window.removeEventListener("notifications:updated", load);
      unsubscribe();
    };
  }, []);

  // Support-ticket badge: unassigned tickets awaiting a taker + my tickets with unread member messages.
  useEffect(() => {
    const load = () =>
      api
        .get<{ unassigned: number; mineUnread: number }>("/api/v1/admin/tickets/stats")
        .then((s) => setTicketsNeedingAttention(s.unassigned + s.mineUnread))
        .catch(() => {});
    load();
    const interval = setInterval(load, 60_000);
    window.addEventListener("admin-tickets:updated", load);

    ticketSocketStore.connect();
    const offEvents = ticketSocketStore.subscribe(load);
    const offReconnect = ticketSocketStore.onReconnect(load);

    return () => {
      clearInterval(interval);
      window.removeEventListener("admin-tickets:updated", load);
      offEvents();
      offReconnect();
    };
  }, []);

  // Services badge: unassigned requests awaiting a taker + my requests with unread member messages
  // + payments that need review.
  useEffect(() => {
    const load = () =>
      api
        .get<{ unassigned: number; mineUnread: number; needsReview: number }>("/api/v1/admin/services/stats")
        .then((s) => setServicesNeedingAttention(s.unassigned + s.mineUnread + s.needsReview))
        .catch(() => {});
    load();
    const interval = setInterval(load, 60_000);
    window.addEventListener("admin-services:updated", load);

    ticketSocketStore.connect();
    const offEvents = ticketSocketStore.subscribeServices(load);
    const offReconnect = ticketSocketStore.onReconnect(load);

    return () => {
      clearInterval(interval);
      window.removeEventListener("admin-services:updated", load);
      offEvents();
      offReconnect();
    };
  }, []);

  const badges: Record<BadgeKey, number | undefined> = {
    notifications: unreadNotifications,
    tickets: ticketsNeedingAttention,
    services: servicesNeedingAttention,
  };

  return { session, badges };
}

function SidebarContent({ data, onNav, collapsed = false, onToggleCollapsed }: {
  data: SidebarData;
  onNav?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, badges } = data;
  const displayName = session?.userName ?? "Admin";
  const displayInitials = session?.userInitials ?? "A";
  const avatarUrl = session?.avatarUrl ?? null;
  const roleLabel = session?.isSuperAdmin ? "Super Admin" : "Admin";

  async function handleLogout() {
    try { await api.post("/api/v1/auth/logout", {}) } catch { /* ignore */ }
    clearSession();
    router.push("/login");
  }

  const groups = navGroups
    .map(g => ({ ...g, items: g.items.filter(item => !item.superAdminOnly || session?.isSuperAdmin) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white text-primary">

      {/* Brand + collapse */}
      <div className={`relative flex items-center gap-2 px-4 pb-4 pt-5 ${collapsed ? "flex-col" : "justify-between"}`}>
        <Brand collapsed={collapsed} />
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-divider hover:text-primary ${
              collapsed ? "mt-3" : ""
            }`}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        )}
      </div>

      <div className="relative mx-4 h-px bg-divider" aria-hidden />

      {/* Nav */}
      <nav aria-label="Admin" className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-4 scrollbar-slim">
        {groups.map((group, gi) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              gi > 0 && <div className="mx-auto my-3 h-px w-6 bg-divider" aria-hidden />
            ) : (
              <p className="px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">{group.label}</p>
            )}
            {collapsed && gi === 0 && <div className="h-4" aria-hidden />}

            {group.items.map(item => {
              const isActive = !!pathname?.startsWith(item.href);
              const Icon = item.icon;
              const badge = item.badge ? badges[item.badge] : undefined;
              const hasBadge = badge != null && badge > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNav}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={collapsed ? (hasBadge ? `${item.label}, ${badge} new` : item.label) : undefined}
                  className={`group relative flex items-center gap-3 rounded-xl py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                    collapsed ? "justify-center px-0" : "px-3"
                  } ${
                    isActive
                      ? "bg-primary text-white shadow-[0_8px_18px_-10px_rgba(21,61,58,0.6)]"
                      : "text-muted hover:bg-divider/70 hover:text-primary"
                  }`}
                >
                  <span className="relative">
                    <Icon
                      size={18}
                      className={`transition-colors duration-200 ${isActive ? "text-lime" : "text-subtle group-hover:text-primary"}`}
                    />
                    {collapsed && hasBadge && (
                      <span
                        className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ${isActive ? "bg-lime ring-primary" : "bg-accent ring-white"}`}
                        aria-hidden
                      />
                    )}
                  </span>

                  {!collapsed && <span className="truncate">{item.label}</span>}

                  {!collapsed && hasBadge && (
                    <span
                      className={`ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-extrabold tabular-nums ${
                        isActive ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {badgeText(badge)}
                    </span>
                  )}

                  {/* Collapsed rail: the label appears as a tooltip beside the icon. */}
                  {collapsed && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-card-hover transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                      {item.label}
                      {hasBadge && <span className="ml-1.5 text-lime">{badgeText(badge)}</span>}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Profile */}
      <div className="relative border-t border-divider p-3">
        <div className={`flex items-center gap-3 rounded-2xl bg-background p-2.5 ${collapsed ? "flex-col" : ""}`}>
          <Link
            href="/admin/profile"
            onClick={onNav}
            title={collapsed ? `${displayName} · ${roleLabel}` : undefined}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition-opacity hover:opacity-90"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-white ring-2 ring-white">
              {avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                : displayInitials}
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-primary">{displayName}</span>
                <span className="mt-0.5 inline-block rounded-full bg-lime px-2 py-px text-[10px] font-bold text-primary">{roleLabel}</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => { onNav?.(); handleLogout(); }}
            aria-label="Log out"
            title="Log out"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-white hover:text-primary"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useCollapsed();
  const data = useSidebarData();

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop */}
      <aside
        className={`hidden h-full shrink-0 overflow-hidden rounded-2xl shadow-card transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
          collapsed ? "w-[84px]" : "w-[264px]"
        }`}
      >
        <SidebarContent data={data} collapsed={collapsed} onToggleCollapsed={() => writeCollapsed(!collapsed)} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden">
        <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-divider bg-white/90 px-4 backdrop-blur">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5" aria-label="Finskool admin home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            <span className="font-display text-sm font-bold text-primary">Finskool</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(v => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-primary transition-colors hover:bg-divider"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Always mounted so it can slide and fade; `inert` keeps it out of the tab order while closed. */}
        <div
          className={`fixed inset-0 z-40 bg-primary/30 backdrop-blur-[2px] transition-opacity duration-300 ${
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Admin menu"
          inert={!mobileOpen}
          className={`fixed inset-y-0 left-0 z-50 w-[280px] border-r border-divider shadow-card-hover transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarContent data={data} onNav={() => setMobileOpen(false)} />
        </aside>
      </div>
    </>
  );
}
