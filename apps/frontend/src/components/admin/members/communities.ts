import { createElement } from "react";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import type { SelectOption } from "@/components/ui/Select";

export interface MemberCommunity {
  id: string;
  name: string;
  slug: string;
  badgeUrl?: string | null;
}

/** Dropdown options for a community picker, each with its badge. */
export function communityOptions(communities: MemberCommunity[]): SelectOption[] {
  return communities.map((c) => ({
    value: c.id,
    label: c.name,
    icon: createElement(CommunityBadgeIcon, { badgeUrl: c.badgeUrl ?? null, className: "h-4 w-4 object-contain" }),
  }));
}
