import { ChevronDown, Lightbulb, MoreHorizontal, Pin, Search, Trash2, Pencil } from "lucide-react";

const posts = [
  {
    id: 1,
    badge: { label: "PINNED", icon: "pin" },
    timestamp: "11 Jun 2026 · 9:42 AM",
    title: "TATASTEEL — Breakout Confirmed. Target ₹175",
    body: "Strong volume breakout above ₹165 resistance. Entry zone ₹163–166, SL below ₹158. Target ₹172–175.",
    tags: ["#TATASTEEL", "#BUY", "#SWING"],
    image: true,
  },
  {
    id: 2,
    badge: { label: "STOCK IDEA", icon: "idea" },
    timestamp: "11 Jun 2026 · 8:15 AM",
    title: "HDFCBANK — Accumulate on Dips Near ₹1,620",
    body: "HDFC Bank showing strong support at ₹1,615–1,620. Suitable for medium-term accumulation with a 3–6 month horizon.",
    tags: ["#HDFCBANK", "#ACCUMULATE"],
    image: false,
  },
  {
    id: 3,
    badge: null,
    timestamp: "11 Jun 2026 · 8:15 AM",
    title: "HDFCBANK — Accumulate on Dips Near ₹1,620",
    body: "HDFC Bank showing strong support at ₹1,615–1,620. Suitable for medium-term accumulation.",
    tags: ["#HDFCBANK", "#ACCUMULATE"],
    image: false,
  },
];

export default function AdminFeedPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-bold text-primary">Live Feed</h1>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 transition-colors focus-within:border-accent sm:flex-none">
            <Search size={16} className="shrink-0 text-subtle" />
            <input
              type="text"
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-40"
            />
          </div>
          <button className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
            <span className="hidden sm:inline">Latest First</span>
            <span className="sm:hidden">Sort</span>
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {posts.map((post) => (
          <div key={post.id} className="group rounded-2xl bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-bold text-lime ring-2 ring-lime/40 ring-offset-2 ring-offset-white">
                  A
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-semibold text-primary">Admin</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">ADMIN</span>
                    {post.badge && (
                      <span className="flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">
                        {post.badge.icon === "pin" && <Pin size={10} />}
                        {post.badge.icon === "idea" && <Lightbulb size={10} />}
                        {post.badge.label}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-subtle">{post.timestamp}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent">
                  <Pencil size={14} />
                </button>
                <button className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {post.image && (
              <div className="mt-4 h-40 overflow-hidden rounded-xl bg-gradient-to-br from-primary/80 to-accent/60">
                <div className="flex h-full items-center justify-center text-white/40 text-sm">Chart Image</div>
              </div>
            )}

            <h3 className="mt-4 font-display text-lg font-bold text-primary">{post.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{post.body}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/5">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
