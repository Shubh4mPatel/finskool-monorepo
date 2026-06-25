const comments = [
  {
    initials: "M1",
    name: "Member #1",
    time: "10:05 AM",
    text: "Entered at ₹164.5. SL placed. Will hold for the target.",
    isAdmin: false,
    reply: true,
  },
  {
    initials: "A",
    name: "Admin",
    time: "10:08 AM",
    text: "Good entry. Keep your SL strict — below ₹158 strictly. Do not average down under any circumstances.",
    isAdmin: true,
    reply: false,
  },
  {
    initials: "M2",
    name: "Member #2",
    time: "10:22 AM",
    text: "Volume confirmation looks strong. Delivery % above 65 — bullish signal",
    isAdmin: false,
    reply: true,
  },
  {
    initials: "M3",
    name: "Member #3",
    time: "10:45 AM",
    text: "What's the holding period on this one?",
    isAdmin: false,
    reply: true,
  },
  {
    initials: "A",
    name: "Admin",
    time: "10:49 AM",
    text: "Holding period 3–5 days ideally. Exit on close below SL or on reaching ₹172+ target.",
    isAdmin: true,
    reply: false,
  },
];

export default function DiscussionThread() {
  return (
    <div className="mt-5 border-t border-divider pt-5">
      <h4 className="font-display text-base font-bold text-primary">
        Discussion <span className="text-sm font-normal text-subtle">(12 replies)</span>
      </h4>

      <div className="mt-4 flex flex-col gap-4">
        {comments.map((comment, i) => (
          <div key={i} className="group flex gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-transform duration-300 group-hover:scale-105 ${
                comment.isAdmin ? "bg-gradient-to-br from-primary to-accent text-lime" : "bg-divider text-primary"
              }`}
            >
              {comment.initials}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-primary">{comment.name}</span>
                {comment.isAdmin && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    ADMIN
                  </span>
                )}
                <span className="text-xs text-subtle">{comment.time}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{comment.text}</p>
              {comment.reply && (
                <button className="mt-1 text-xs font-semibold text-accent transition-colors hover:text-primary">
                  Reply
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <a href="#" className="mt-4 inline-block text-sm font-semibold text-accent transition-colors hover:text-primary">
        View Reply (10)
      </a>

      <div className="mt-5 border-t border-divider pt-5">
        <textarea
          placeholder="Add to the discussion…"
          rows={3}
          className="w-full resize-none rounded-xl border border-divider bg-background px-4 py-3 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="text-xs text-subtle">Your identity is kept private from other members</p>
          <button className="shrink-0 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95">
            Post Reply
          </button>
        </div>
      </div>
    </div>
  );
}
