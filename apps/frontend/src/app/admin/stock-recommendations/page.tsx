import { TrendingUp } from "lucide-react";

export default function AdminStockRecommendationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Stock Recommendation</p>
        <h1 className="font-display text-2xl font-bold text-primary">Stock Recommendation</h1>
      </div>
      <div className="animate-rise flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-divider bg-white p-16 text-center shadow-card">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/50 to-accent/10 text-primary shadow-glow">
          <TrendingUp size={26} />
        </div>
        <p className="font-display text-lg font-bold text-primary">Coming Soon</p>
        <p className="max-w-sm text-sm text-muted">Stock recommendation management will be available here.</p>
      </div>
    </div>
  );
}
