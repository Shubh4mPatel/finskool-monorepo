// Limits mirror apps/backend/src/modules/welcome-kits/welcome-kits.validator.ts.
export const MAX_YOUTUBE_URLS = 5;
export const MAX_STRATEGIES = 10;
export const MAX_NOTICES = 5;
export const MAX_POINTERS = 15;

export type NoticeType = "normal" | "warning";

export interface KitVideo {
  url: string; // canonical YouTube watch URL — the only thing saved
  title: string | null;
  thumbnailUrl: string | null;
}
export interface StrategyRow { id: string; value: string; label: string }
export interface NoticeRow { id: string; type: NoticeType; heading: string; description: string }
export interface PointerRow { id: string; text: string }

/** Editor state. Row `id`s are client-only (React keys / drag & drop); order = priority. */
export interface KitForm {
  introMarkdown: string;
  videos: KitVideo[];
  heroStat: string;
  description: string;
  strategyTitle: string;
  strategies: StrategyRow[];
  notices: NoticeRow[];
  pointers: PointerRow[];
}

// Shape returned by GET /api/v1/admin/communities/:id/welcome-kit
export interface ServerKit {
  communityId: string;
  communityName: string;
  watchBeforeYouStart: { introMarkdown: string; youtubeUrls: string[] } | null;
  capitalAllocation: {
    heroStat: string;
    description: string;
    strategyTitle: string;
    strategies: { priority: number; value: string; label: string }[];
  } | null;
  strategyNotices: { priority: number; type: NoticeType; heading: string; description: string }[];
  whatYouGet: { priority: number; text: string }[];
}

export interface KitListItem {
  communityId: string;
  name: string;
  slug: string;
  type: string | null;
  coverImageUrl: string | null;
  badgeUrl: string | null;
  hasKit: boolean;
  updatedAt: string | null;
}

export const newId = (): string => crypto.randomUUID();

export const emptyForm = (): KitForm => ({
  introMarkdown: "",
  videos: [],
  heroStat: "",
  description: "",
  strategyTitle: "",
  strategies: [],
  notices: [],
  pointers: [],
});

export function formFromKit(kit: ServerKit | null): KitForm {
  if (!kit) return emptyForm();
  return {
    introMarkdown: kit.watchBeforeYouStart?.introMarkdown ?? "",
    videos: (kit.watchBeforeYouStart?.youtubeUrls ?? []).map((url) => ({ url, title: null, thumbnailUrl: null })),
    heroStat: kit.capitalAllocation?.heroStat ?? "",
    description: kit.capitalAllocation?.description ?? "",
    strategyTitle: kit.capitalAllocation?.strategyTitle ?? "",
    strategies: (kit.capitalAllocation?.strategies ?? []).map((s) => ({ id: newId(), value: s.value, label: s.label })),
    notices: kit.strategyNotices.map((n) => ({ id: newId(), type: n.type, heading: n.heading, description: n.description })),
    pointers: kit.whatYouGet.map((p) => ({ id: newId(), text: p.text })),
  };
}

/** Body for PUT /api/v1/admin/communities/:id/welcome-kit — lists in display order. */
export function kitPayload(f: KitForm) {
  return {
    watchBeforeYouStart: { introMarkdown: f.introMarkdown, youtubeUrls: f.videos.map((v) => v.url) },
    capitalAllocation: {
      heroStat: f.heroStat.trim(),
      description: f.description.trim(),
      strategyTitle: f.strategyTitle.trim(),
      strategies: f.strategies.map((s) => ({ value: s.value.trim(), label: s.label.trim() })),
    },
    strategyNotices: f.notices.map((n) => ({ type: n.type, heading: n.heading.trim(), description: n.description.trim() })),
    whatYouGet: f.pointers.map((p) => ({ text: p.text.trim() })),
  };
}

export function hasWatchContent(f: KitForm): boolean {
  return f.introMarkdown.trim() !== "" || f.videos.length > 0;
}
export function hasCapitalContent(f: KitForm): boolean {
  return f.heroStat.trim() !== "" || f.description.trim() !== "" || f.strategies.length > 0;
}

/** First problem found (as a message), or null if the form can be saved. */
export function validateForm(f: KitForm): string | null {
  if (!hasWatchContent(f) && !hasCapitalContent(f) && f.notices.length === 0 && f.pointers.length === 0) {
    return "Add some content to at least one section.";
  }
  if (f.introMarkdown.length > 5000) return "The intro paragraph is too long (max 5000 characters).";
  if (f.heroStat.trim().length > 50) return "Hero stat can be at most 50 characters.";
  const strategy = f.strategies.findIndex((s) => !s.value.trim() || !s.label.trim());
  if (strategy >= 0) return `Strategy ${strategy + 1} needs both a value and a label.`;
  const notice = f.notices.findIndex((n) => !n.heading.trim());
  if (notice >= 0) return `Strategy notice ${notice + 1} needs a heading.`;
  const pointer = f.pointers.findIndex((p) => !p.text.trim());
  if (pointer >= 0) return `“What you get” pointer ${pointer + 1} needs some text.`;
  return null;
}
