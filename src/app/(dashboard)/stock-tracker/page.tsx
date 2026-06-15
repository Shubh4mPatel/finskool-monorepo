import { BarChart3 } from "lucide-react";

export default function StockTrackerPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-primary">Stock Tracker</h1>

      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white p-16 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider text-primary">
          <BarChart3 size={24} />
        </div>
        <p className="font-display text-lg font-bold text-primary">No stocks tracked yet</p>
        <p className="max-w-sm text-sm text-muted">
          Stocks from active recommendations will appear here so you can track their performance.
        </p>
      </div>
    </div>
  );
}
