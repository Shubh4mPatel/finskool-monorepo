import { ChevronDown, LayoutGrid, Search } from "lucide-react";

const stats = [
  { value: "14", label: "Total Calls" },
  { value: "11", label: "Active" },
  { value: "+18.4%", label: "Avg Return", positive: true },
  { value: "76%", label: "Win Rate" },
];

const riskStyles: Record<string, string> = {
  Low: "text-accent",
  Medium: "text-amber-500",
  High: "text-red-500",
};

const callStyles: Record<string, string> = {
  BUY: "bg-accent text-white",
  HOLD: "bg-amber-400 text-white",
  SELL: "bg-red-400 text-white",
};

const recommendations = [
  {
    company: "Adani Power",
    exchange: "NSE",
    sector: "Energy",
    date: "12 May 2026",
    entry: "₹2,780",
    cmp: "₹3,100",
    target: "₹3,400",
    stopLoss: "₹2,600",
    return: "+13.4%",
    risk: "Low",
    call: "BUY",
    color: "bg-orange-100 text-orange-600",
  },
  {
    company: "Infosys",
    exchange: "NSE",
    sector: "IT",
    date: "28 Apr 2026",
    entry: "₹1,480",
    cmp: "₹1,800",
    target: "₹2,100",
    stopLoss: "₹1,380",
    return: "+21.6%",
    risk: "Medium",
    call: "BUY",
    color: "bg-blue-100 text-blue-600",
  },
  {
    company: "TATA Motors",
    exchange: "NSE",
    sector: "Auto",
    date: "03 Mar 2026",
    entry: "₹685",
    cmp: "₹1,050",
    target: "₹1,200",
    stopLoss: "₹620",
    return: "+53.2%",
    risk: "High",
    call: "HOLD",
    color: "bg-purple-100 text-purple-600",
  },
  {
    company: "ITC",
    exchange: "FMCG",
    sector: "FMCG",
    date: "18 Apr 2026",
    entry: "₹380",
    cmp: "₹460",
    target: "₹520",
    stopLoss: "₹350",
    return: "+21.0%",
    risk: "Low",
    call: "BUY",
    color: "bg-lime/40 text-primary",
  },
  {
    company: "Wipro",
    exchange: "NSE",
    sector: "IT",
    date: "05 May 2026",
    entry: "₹420",
    cmp: "₹390",
    target: "₹500",
    stopLoss: "₹395",
    return: "-7.1%",
    risk: "Medium",
    call: "HOLD",
    color: "bg-blue-100 text-blue-600",
  },
  {
    company: "Bajaj Finance",
    exchange: "NSE",
    sector: "NBFC",
    date: "20 Apr 2026",
    entry: "₹6,200",
    cmp: "₹7,100",
    target: "₹7,800",
    stopLoss: "₹5,900",
    return: "+14.5%",
    risk: "Low",
    call: "SELL",
    color: "bg-slate-100 text-slate-600",
  },
];

export default function RecommendationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Active Recommendations</h1>
          <p className="mt-1 text-sm text-muted">Stock calls from your admin. Updated in real-time.</p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Date
              <ChevronDown size={14} />
            </button>
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Sector
              <ChevronDown size={14} />
            </button>
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Calls
              <ChevronDown size={14} />
            </button>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Last updated: 2 min ago
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="animate-rise rounded-2xl bg-white p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className={`font-display text-2xl font-bold ${stat.positive ? "text-accent" : "text-primary"}`}>
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white">
              <LayoutGrid size={16} />
            </span>
            All Calls
          </h2>
          <div className="flex w-full items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent sm:w-auto">
            <Search size={16} className="text-subtle shrink-0" />
            <input
              type="text"
              placeholder="Search stocks…"
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-40"
            />
          </div>
        </div>

        {/* Mobile / tablet card list */}
        <div className="mt-4 flex flex-col gap-3 lg:hidden">
          {recommendations.map((row) => (
            <div
              key={row.company}
              className="rounded-xl border border-divider p-4 transition-shadow duration-300 hover:shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${row.color}`}>
                    {row.company.slice(0, 1)}
                  </span>
                  <div>
                    <p className="font-semibold text-primary">{row.company}</p>
                    <p className="text-xs text-subtle">
                      {row.exchange} · {row.sector}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${callStyles[row.call]}`}>
                  {row.call}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-subtle">Entry ₹</p>
                  <p className="font-semibold text-primary">{row.entry}</p>
                </div>
                <div>
                  <p className="text-xs text-subtle">CMP ₹</p>
                  <p className="font-semibold text-primary">{row.cmp}</p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Target ₹</p>
                  <p className="font-semibold text-primary">{row.target}</p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Stop Loss ₹</p>
                  <p className="font-semibold text-primary">{row.stopLoss}</p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Return</p>
                  <p className={`font-semibold ${row.return.startsWith("-") ? "text-red-500" : "text-accent"}`}>
                    {row.return}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Risk</p>
                  <p className={`font-semibold ${riskStyles[row.risk]}`}>{row.risk}</p>
                </div>
              </div>

              <p className="mt-3 text-xs text-subtle">Recommended {row.date}</p>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="mt-4 hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold text-subtle">
                <th className="px-3 py-2">COMPANY</th>
                <th className="px-3 py-2">SECTOR</th>
                <th className="px-3 py-2">REC. DATE</th>
                <th className="px-3 py-2">ENTRY ₹</th>
                <th className="px-3 py-2">CMP ₹</th>
                <th className="px-3 py-2">TARGET ₹</th>
                <th className="px-3 py-2">STOP LOSS ₹</th>
                <th className="px-3 py-2">RETURN %</th>
                <th className="px-3 py-2">RISK</th>
                <th className="px-3 py-2">CALL</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((row) => (
                <tr key={row.company} className="border-t border-divider transition-colors hover:bg-background">
                  <td className="flex items-center gap-3 px-3 py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${row.color}`}>
                      {row.company.slice(0, 1)}
                    </span>
                    <div>
                      <p className="font-semibold text-primary">{row.company}</p>
                      <p className="text-xs text-subtle">{row.exchange}</p>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">{row.sector}</td>
                  <td className="px-3 py-3 text-muted">{row.date}</td>
                  <td className="px-3 py-3 text-muted">{row.entry}</td>
                  <td className="px-3 py-3 font-semibold text-primary">{row.cmp}</td>
                  <td className="px-3 py-3 text-muted">{row.target}</td>
                  <td className="px-3 py-3 text-muted">{row.stopLoss}</td>
                  <td className={`px-3 py-3 font-semibold ${row.return.startsWith("-") ? "text-red-500" : "text-accent"}`}>
                    {row.return}
                  </td>
                  <td className={`px-3 py-3 font-semibold ${riskStyles[row.risk]}`}>{row.risk}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${callStyles[row.call]}`}>
                      {row.call}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-subtle">Showing 6 of 14 recommendations</p>
          <div className="flex items-center gap-2">
            <button className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary">
              Previous
            </button>
            <button className="h-8 w-8 rounded-full bg-primary text-sm font-semibold text-white shadow-glow">1</button>
            <button className="h-8 w-8 rounded-full text-sm font-semibold text-muted transition-colors hover:bg-divider/60 hover:text-primary">2</button>
            <button className="h-8 w-8 rounded-full text-sm font-semibold text-muted transition-colors hover:bg-divider/60 hover:text-primary">3</button>
            <button className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary">
              Next
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-subtle">
        These are admin recommendations only. Past performance does not guarantee future results. Trade at your own risk.
      </p>
    </div>
  );
}
