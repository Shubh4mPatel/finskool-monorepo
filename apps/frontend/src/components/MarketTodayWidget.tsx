import { ChevronRight } from "lucide-react";

const indices = [
  { name: "NIFTY 50", value: "24,351", change: "+0.82%", up: true },
  { name: "SENSEX", value: "80,218", change: "+0.74%", up: true },
  { name: "BANK NIFTY", value: "52,440", change: "−0.31%", up: false },
  { name: "NIFTY IT", value: "38,760", change: "+1.24%", up: true },
];

export default function MarketTodayWidget() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-primary">
        <ChevronRight size={14} className="text-accent" />
        Market Today
      </h3>

      <div className="mt-4 flex flex-col gap-3">
        {indices.map((index) => (
          <div key={index.name} className="flex items-center justify-between">
            <span className="text-sm font-semibold text-primary">{index.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#5a6a60]">{index.value}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  index.up ? "bg-[#edfad4] text-[#2d6a1a]" : "bg-[#fff0f0] text-[#d93030]"
                }`}
              >
                {index.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-[#e05050]">Prices delayed 15 min</p>
    </div>
  );
}
