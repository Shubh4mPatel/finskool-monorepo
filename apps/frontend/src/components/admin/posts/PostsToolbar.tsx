"use client";

import { useState } from "react";
import { ArrowDownUp, Calendar, ChevronDown, Search, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import type { CommunityOption } from "./types";
import { useEscape } from "./useEscape";

// Secondary toolbar control: white pill; `active` tints it when it is filtering the list.
const controlClass = (active: boolean) =>
  `flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all ${
    active
      ? "border-accent/40 bg-accent/10 text-primary"
      : "border-divider bg-white text-muted hover:border-subtle hover:text-primary"
  }`;

/** Search, community, date and sort for an admin post list — sticks to the top while scrolling. */
export default function PostsToolbar({
  search,
  onSearch,
  communities,
  communityId,
  onCommunity,
  date,
  onDate,
  sortDesc,
  onToggleSort,
  hasFilters,
  onClear,
}: {
  search: string;
  onSearch: (s: string) => void;
  communities: CommunityOption[];
  communityId: string;
  onCommunity: (id: string) => void;
  date: Date | undefined;
  onDate: (d: Date | undefined) => void;
  sortDesc: boolean;
  onToggleSort: () => void;
  hasFilters: boolean;
  onClear: () => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  useEscape(showDatePicker, () => setShowDatePicker(false));

  return (
    <div className="sticky top-0 z-20 -mx-1 bg-background/85 px-1 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white p-2.5 shadow-card ring-1 ring-primary/[0.04]">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
          <Search size={16} className="shrink-0 text-subtle" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search titles and #tags on this page"
            aria-label="Search posts"
            className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
          />
          {search && (
            <button type="button" onClick={() => onSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="relative shrink-0">
          <select
            value={communityId}
            onChange={e => onCommunity(e.target.value)}
            aria-label="Community"
            className={`${controlClass(!!communityId)} appearance-none pr-9 focus:outline-none`}
          >
            <option value="">All communities</option>
            {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle" />
        </div>

        <div className="relative flex shrink-0 items-center">
          <button
            onClick={() => setShowDatePicker(v => !v)}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showDatePicker}
            className={`${controlClass(!!date)} ${date ? "pr-9" : ""}`}
          >
            <Calendar size={14} />
            {date ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Any date"}
          </button>
          {date && (
            <button
              type="button"
              onClick={() => onDate(undefined)}
              aria-label="Clear date"
              className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-white hover:text-primary"
            >
              <X size={12} />
            </button>
          )}

          {showDatePicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
              <div className="rdp-theme animate-fade fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl bg-white p-3 shadow-card-hover sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-auto sm:translate-y-0">
                <DayPicker
                  mode="single"
                  selected={date}
                  onSelect={d => { onDate(d); setShowDatePicker(false); }}
                  autoFocus
                />
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleSort}
          aria-label={sortDesc ? "Sorted newest first. Switch to oldest first" : "Sorted oldest first. Switch to newest first"}
          className={controlClass(false)}
        >
          <ArrowDownUp size={14} />
          {sortDesc ? "Newest first" : "Oldest first"}
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
