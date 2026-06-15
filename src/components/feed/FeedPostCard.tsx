import { ArrowRight, Lightbulb, Pin } from "lucide-react";
import type { ReactNode } from "react";
import PriceChart from "./PriceChart";

type FeedPostCardProps = {
  badge?: { label: string; icon?: "pin" | "idea" };
  timestamp: string;
  title: string;
  body: string;
  tags: string[];
  viewThreadCount: number;
  showChart?: boolean;
  reactions?: number;
  children?: ReactNode;
};

export default function FeedPostCard({
  badge,
  timestamp,
  title,
  body,
  tags,
  viewThreadCount,
  showChart,
  reactions,
  children,
}: FeedPostCardProps) {
  return (
    <div className="group rounded-2xl bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-lime ring-2 ring-lime/40 ring-offset-2 ring-offset-white">
            A
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold text-primary">Admin</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                ADMIN
              </span>
              {badge && (
                <span className="flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">
                  {badge.icon === "pin" && <Pin size={10} />}
                  {badge.icon === "idea" && <Lightbulb size={10} />}
                  {badge.label}
                </span>
              )}
            </div>
            <span className="text-xs text-subtle">{timestamp}</span>
          </div>
        </div>
        {reactions != null && (
          <span className="rounded-full bg-divider px-3 py-1 text-xs font-semibold text-muted transition-colors group-hover:bg-lime/40 group-hover:text-primary">
            {reactions}
          </span>
        )}
      </div>

      <h3 className="mt-4 font-display text-lg font-bold text-primary">{title}</h3>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{body}</p>

      {showChart && (
        <div className="mt-4">
          <PriceChart />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/5"
          >
            {tag}
          </span>
        ))}
      </div>

      {children}

      <a
        href="#"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent"
      >
        View Thread ({viewThreadCount})
        <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
      </a>
    </div>
  );
}
