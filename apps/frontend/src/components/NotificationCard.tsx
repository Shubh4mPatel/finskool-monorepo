"use client";

import {
  Megaphone,
  MessagesSquare,
  TrendingUp,
  RefreshCw,
  Users,
  UserPlus,
  Upload,
} from "lucide-react";

export interface Notification {
  id: string;
  communityId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListNotificationsResponse {
  notifications: Notification[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ICONS: Record<string, typeof Megaphone> = {
  thread: MessagesSquare,
  "new-member-reply": MessagesSquare,
  recommendation: TrendingUp,
  "subscription-extended": RefreshCw,
  "community-added": Users,
  "new-member-registered": UserPlus,
  "import-complete": Upload,
};

export function NotificationCard({
  notification,
  onView,
}: {
  notification: Notification;
  onView: (notification: Notification) => void;
}) {
  const Icon = ICONS[notification.type] ?? Megaphone;
  const timestamp = formatRelativeTime(notification.createdAt);

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-card">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon size={22} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-semibold text-black">{notification.title}</p>
          <p className="text-sm text-black/70">{notification.message}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-black/60">{timestamp}</span>
          <button
            type="button"
            onClick={() => onView(notification)}
            className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold text-white"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
}
