import { getInitials } from "@/lib/memberFormat";

// Soft tint pairs — purely decorative (identity is the name beside it), so they only need to look
// good together and keep their text readable on the tint.
const TINTS = [
  "bg-[#dff1ee] text-accent",
  "bg-lime/50 text-primary",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-600",
  "bg-sky-100 text-sky-700",
];

/** The same member always gets the same tint, so rows stay recognisable between visits. */
function tintFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

export function TintAvatar({ name, className = "h-9 w-9" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-white ${tintFor(name)} ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}
