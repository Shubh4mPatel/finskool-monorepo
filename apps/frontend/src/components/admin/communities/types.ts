export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  coverImageUrl: string | null;
  badgeUrl: string | null;
  paymentLink: string | null;
  memberCount: number;
  // Present when the API says so: the one open "Feed" community every member can see.
  isFree?: boolean;
}

export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
