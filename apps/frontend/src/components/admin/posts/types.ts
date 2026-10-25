import type { PostVideo } from "@/lib/post-videos";

// Shared by the admin Live Feed and All Posts pages — both read GET /api/v1/posts.

export interface AdminPost {
  id: string;
  communityId: string;
  communityName: string;
  communitySlug: string;
  communityBadgeUrl: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  imageUrls: string[];
  videos?: PostVideo[];
  reactionCounts?: Record<string, number>;
  groupReactionCounts?: Record<string, number>;
  groupSize?: number;
  tags: string[];
  pinOrder: number | null;
  publishedAt: string | null;
  createdAt: string;
  commentCount: number;
}

export interface ListPostsResponse {
  posts: AdminPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CommunityOption {
  id: string;
  name: string;
  badgeUrl?: string | null;
  isFree?: boolean;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

export { toDateParam } from "@/lib/dates";
