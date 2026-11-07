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
  // Each image with its real size; ratio/orientation are the post's, from its first sized image or uploaded video.
  images?: { url: string; width: number | null; height: number | null; ratio: number | null; orientation: "portrait" | "landscape" | null }[];
  ratio?: number | null;
  orientation?: "portrait" | "landscape" | null;
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
  pageSize: number;
  // Send as `cursor` to get the posts after these; null once there are none.
  nextCursor: string | null;
  // Only the first page (no cursor sent) is counted.
  total?: number;
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
