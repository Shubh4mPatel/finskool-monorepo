export default function PriceChart() {
  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-divider/50 to-divider/20 p-4">
      <div className="flex items-center justify-between text-xs font-semibold text-accent">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Target ₹175
        </span>
      </div>

      <svg viewBox="0 0 400 140" className="mt-1 h-32 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c1f26e" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#c1f26e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="priceStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#108b8b" />
            <stop offset="100%" stopColor="#153d3a" />
          </linearGradient>
        </defs>

        <line x1="0" y1="10" x2="400" y2="10" stroke="#108b8b" strokeDasharray="4 4" strokeWidth="1" />
        <line x1="0" y1="120" x2="400" y2="120" stroke="#a0a89e" strokeDasharray="4 4" strokeWidth="1" />

        <path
          d="M0,110 L40,100 L80,105 L120,85 L160,90 L200,65 L240,70 L280,45 L320,50 L360,25 L400,15 L400,140 L0,140 Z"
          fill="url(#priceFill)"
        />
        <path
          className="animate-draw"
          d="M0,110 L40,100 L80,105 L120,85 L160,90 L200,65 L240,70 L280,45 L320,50 L360,25 L400,15"
          fill="none"
          stroke="url(#priceStroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          strokeDasharray="1"
        />
        <circle cx="400" cy="15" r="4" fill="#108b8b" />
      </svg>

      <div className="flex items-center justify-between text-xs font-semibold text-subtle">
        <span>₹158 SL</span>
      </div>
    </div>
  );
}
