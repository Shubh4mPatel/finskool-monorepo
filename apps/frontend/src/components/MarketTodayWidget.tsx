import { TrendingUp } from "lucide-react";

const indices = [
  { name: "NIFTY 50", value: "24,351", change: "+0.82%", up: true },
  { name: "SENSEX", value: "80,218", change: "+0.74%", up: true },
  { name: "BANK NIFTY", value: "52,440", change: "−0.31%", up: false },
  { name: "NIFTY IT", value: "38,760", change: "+1.24%", up: true },
];

export default function MarketTodayWidget() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card transition-shadow duration-300 hover:shadow-card-hover">
      <div className="h-1 w-full bg-gradient-to-r from-accent via-lime to-accent" />
      <div className="p-5">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-primary">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
            <TrendingUp size={14} />
          </span>
          Market Today
        </h3>

        <div className="mt-4 flex flex-col gap-3">
          {indices.map((index) => (
            <div
              key={index.name}
              className="flex items-center justify-between rounded-xl px-2 py-1.5 -mx-2 transition-colors hover:bg-background"
            >
              <span className="text-sm font-semibold text-primary">{index.name}</span>
              <div className="text-right">
                <p className="text-sm font-semibold text-primary">{index.value}</p>
                <p
                  className={`text-xs font-medium ${
                    index.up ? "text-accent" : "text-red-500"
                  }`}
                >
                  {index.change}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-subtle">Prices delayed 15 min</p>
      </div>
    </div>
  );
}
