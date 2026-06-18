"use client";

import { useState } from "react";
import { Check, CheckCheck, ChevronDown } from "lucide-react";

const threads = [
  {
    id: 1,
    member: "Jai Sharma",
    initials: "JS",
    community: "Swing Alpha",
    communityColor: "bg-lime/40 text-primary",
    timestamp: "11 Jun 2026 · 9:17 AM",
    postRef: "TATASTEEL — Breakout Confirmed. Target ₹175",
    question: "What is the updated stop loss after today's candle close? Should we trail it to ₹161 or keep at ₹158?",
  },
  {
    id: 2,
    member: "Ram Sharma",
    initials: "RS",
    community: "Investor Community",
    communityColor: "bg-accent/10 text-accent",
    timestamp: "12 Jun 2026 · 11:25 AM",
    postRef: "RELIANCE — 3 Year Index Play. Target ₹1,800+",
    question: "Admin, should we add more quantity at ₹1,370 or wait for a deeper correction to ₹1,340 levels?",
  },
  {
    id: 3,
    member: "Neha",
    initials: "N",
    community: "Swing Alpha",
    communityColor: "bg-lime/40 text-primary",
    timestamp: "12 Jun 2026 · 12:50 PM",
    postRef: "HDFCBANK — Accumulate on Dips Near ₹1,620",
    question: "Is the accumulation zone still valid at ₹1,620 or has the level shifted after today's RBI news?",
  },
  {
    id: 4,
    member: "Ram Sharma",
    initials: "RS",
    community: "Investor Community",
    communityColor: "bg-accent/10 text-accent",
    timestamp: "12 Jun 2026 · 1:19 PM",
    postRef: "Weekly Performance Update — Week 23",
    question: "Great performance this month. Will there be a detailed breakdown of individual call P&L?",
  },
  {
    id: 5,
    member: "Shweta Sharma",
    initials: "SS",
    community: "Swing Alpha",
    communityColor: "bg-lime/40 text-primary",
    timestamp: "12 Jun 2026 · 2:00 PM",
    postRef: "TATASTEEL — Breakout Confirmed",
    question: "Target hit partially at ₹170. Should we book partial profits now?",
  },
];

export default function UnresolvedThreadsPage() {
  const [activeTab, setActiveTab] = useState("All");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [marked, setMarked] = useState<Set<number>>(new Set());

  const tabs = ["All", "Swing Alpha", "Investor Community"];
  const filtered = threads.filter((t) => {
    if (activeTab === "All") return true;
    return t.community === activeTab;
  });
  const pending = filtered.filter((t) => !marked.has(t.id)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Unresolved Threads</p>
          <h1 className="font-display text-2xl font-bold text-primary">Unresolved Threads</h1>
          <p className="mt-1 text-sm text-muted">Member comments waiting for your response. Oldest first.</p>
        </div>
        {pending > 0 && (
          <span className="mt-1 rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-500">
            {pending} pending
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab ? "bg-primary text-white" : "bg-white text-muted shadow-card hover:bg-divider/60 hover:text-primary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-muted shadow-card transition-colors hover:text-primary">
            Oldest First <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setMarked(new Set(filtered.map((t) => t.id)))}
            className="flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary"
          >
            <CheckCheck size={14} />
            Mark All Replied
          </button>
        </div>
      </div>

      {pending === 0 ? (
        <div className="animate-rise flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-divider bg-white p-16 text-center shadow-card">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/50 to-accent/10 text-primary shadow-glow">
            <Check size={26} />
          </div>
          <p className="font-display text-lg font-bold text-primary">All caught up!</p>
          <p className="max-w-sm text-sm text-muted">Every member comment has received a reply. Great work keeping the community engaged.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((thread) => {
            const isDone = marked.has(thread.id);
            const isReplying = replyingTo === thread.id;
            return (
              <div
                key={thread.id}
                className={`rounded-2xl bg-white p-5 shadow-card transition-all duration-300 ${isDone ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-lime">
                    {thread.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-semibold text-primary">{thread.member}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${thread.communityColor}`}>
                        {thread.community}
                      </span>
                      <span className="text-xs text-subtle">{thread.timestamp}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-subtle">
                      Re: <span className="font-medium text-muted">{thread.postRef}</span>
                    </p>
                    <p className="mt-2 text-sm text-primary">{thread.question}</p>

                    {isReplying && (
                      <div className="mt-4 rounded-xl border border-accent/40 bg-background p-3">
                        <p className="text-xs text-subtle italic">&ldquo;{thread.question}&rdquo;</p>
                        <textarea
                          rows={3}
                          placeholder="Type your reply here..."
                          value={replies[thread.id] || ""}
                          onChange={(e) => setReplies((r) => ({ ...r, [thread.id]: e.target.value }))}
                          className="mt-2 w-full resize-none rounded-lg border border-divider bg-white px-3 py-2 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            onClick={() => setReplyingTo(null)}
                            className="rounded-full px-4 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-primary"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              setMarked((m) => new Set([...m, thread.id]));
                              setReplyingTo(null);
                            }}
                            className="rounded-full bg-gradient-to-r from-accent to-primary px-4 py-1.5 text-xs font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
                          >
                            Post Reply →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {!isDone && !isReplying && (
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setReplyingTo(thread.id)}
                      className="rounded-full bg-gradient-to-r from-accent to-primary px-4 py-1.5 text-xs font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => setMarked((m) => new Set([...m, thread.id]))}
                      className="flex items-center gap-1.5 rounded-full border border-divider px-4 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-primary"
                    >
                      <Check size={12} />
                      Mark Replied
                    </button>
                  </div>
                )}
                {isDone && (
                  <div className="mt-3 flex items-center justify-end gap-1.5 text-xs font-semibold text-accent">
                    <CheckCheck size={14} />
                    Replied
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
