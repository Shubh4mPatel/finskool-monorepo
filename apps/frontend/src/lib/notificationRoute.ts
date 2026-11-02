/**
 * Where a notification opens on the web dashboard. Same idea as the mobile app: every notification carries
 * routing data `{ type, id, communityId?, event? }` (set by the server), and that decides the page. The
 * notification's own `type` is only a fallback for old rows that have no routing data.
 */
interface RoutableNotification {
  type: string;
  data: Record<string, string> | null;
}

// Old rows (no routing data) and types whose page does not depend on an id.
const ROUTE_BY_TYPE: Record<string, string> = {
  thread: "/admin/feed",
  reaction: "/admin/feed", // the post is gone
  "new-member-registered": "/admin/members",
  "import-complete": "/admin/import-csv",
  "admin-payment-flagged": "/admin/payment-flags",
  "admin-new-ticket": "/admin/tickets",
  "admin-ticket-reply": "/admin/tickets",
  "admin-new-service-request": "/admin/services",
  "admin-service-message": "/admin/services",
  "admin-service-paid": "/admin/services",
};

export function notificationRoute(n: RoutableNotification): string | null {
  // An import summary is shown on the import page, not on the members list its routing data names.
  if (n.type === "import-complete") return "/admin/import-csv";
  const d = n.data;
  if (d?.type && d.id) {
    switch (d.type) {
      case "post":
      case "feed":
        return `/admin/feed?post=${encodeURIComponent(d.id)}`;
      case "member":
        return `/admin/members/${encodeURIComponent(d.id)}`;
      case "members": // an import finished: the community's members
      case "subscriptions": // access ending soon: the members list shows who
        return "/admin/members";
      case "threads": // unanswered member questions
        return "/admin/feed";
      case "ticket":
        return `/admin/tickets/${encodeURIComponent(d.id)}`;
      case "service":
        return `/admin/services/${encodeURIComponent(d.id)}`;
      case "payment-flags": // a payment that could not be applied: the review list, with this request marked
        return `/admin/payment-flags?request=${encodeURIComponent(d.id)}`;
      case "recommendation":
        return "/admin/stock-recommendations";
    }
  }
  return ROUTE_BY_TYPE[n.type] ?? null;
}
