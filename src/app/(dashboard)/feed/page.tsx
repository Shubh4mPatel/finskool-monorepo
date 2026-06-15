import { ChevronDown, Search } from "lucide-react";
import CommunityRulesWidget from "@/components/CommunityRulesWidget";
import MarketTodayWidget from "@/components/MarketTodayWidget";
import DiscussionThread from "@/components/feed/DiscussionThread";
import FeedPostCard from "@/components/feed/FeedPostCard";

export default function FeedPage() {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-2xl font-bold text-primary">Live Feed</h1>

          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 transition-colors focus-within:border-accent sm:flex-none">
              <Search size={16} className="text-subtle shrink-0" />
              <input
                type="text"
                placeholder="Search......"
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

        <div className="animate-rise">
          <FeedPostCard
            badge={{ label: "PINNED", icon: "pin" }}
            timestamp="Today, 9:42 AM"
            title="TATASTEEL — Breakout Confirmed. Target ₹175"
            body={
              "Strong volume breakout above ₹165 resistance with above-average delivery volumes. RSI at 58 — not overbought.\nEntry zone ₹163–166. Stop Loss strictly below ₹158. Target ₹172–175. Risk-reward ratio 1:3.\nPosition sizing: max 3% of capital."
            }
            tags={["#TATASTEEL", "#BUY", "#SWING", "#NSE"]}
            viewThreadCount={20}
            showChart
          >
            <DiscussionThread />
          </FeedPostCard>
        </div>

        <div className="animate-rise [animation-delay:100ms]">
          <FeedPostCard
            badge={{ label: "STOCK IDEA", icon: "idea" }}
            timestamp="Today, 8:15 AM"
            title="HDFCBANK — Accumulate on Dips Near ₹1,620"
            body="HDFC Bank showing strong support at ₹1,615–1,620. Suitable for medium-term accumulation with a 3–6 month horizon."
            tags={["#HDFCBANK", "#ACCUMULATE"]}
            viewThreadCount={2}
            reactions={47}
          />
        </div>

        <div className="animate-rise [animation-delay:200ms]">
          <FeedPostCard
            timestamp="Yesterday, 6:00 PM"
            title="Weekly Performance Update — Week 23"
            body="This week we closed 4 out of 5 trades in profit. Total portfolio return for the week: +3.2%. Full breakdown below."
            tags={[]}
            viewThreadCount={10}
          />
        </div>
      </div>

      <aside className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:w-[300px] lg:shrink-0 lg:grid-cols-1">
        <MarketTodayWidget />
        <CommunityRulesWidget />
      </aside>
    </div>
  );
}
