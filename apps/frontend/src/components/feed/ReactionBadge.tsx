import type { IconType } from "react-icons";
import { FaFaceLaughBeam, FaHandsClapping, FaHeart, FaLightbulb, FaThumbsUp } from "react-icons/fa6";

// One coloured badge per reaction type, by the type's name. A type the app does not know yet falls back to its emoji.
const BADGES: Record<string, { Icon: IconType; bg: string; label: string }> = {
  like: { Icon: FaThumbsUp, bg: "#3B8BE0", label: "Like" },
  love: { Icon: FaHeart, bg: "#E5555E", label: "Love" },
  insightful: { Icon: FaLightbulb, bg: "#F4C430", label: "Insightful" },
  haha: { Icon: FaFaceLaughBeam, bg: "#0F8B8D", label: "Haha" },
  celebrate: { Icon: FaHandsClapping, bg: "#6AAC47", label: "Celebrate" },
};

export default function ReactionBadge({ name, emoji, size = 22 }: { name: string; emoji: string; size?: number }) {
  const badge = BADGES[name];
  if (!badge) return <span style={{ fontSize: size * 0.8 }}>{emoji}</span>;
  const { Icon, bg, label } = badge;
  return (
    <span
      title={label}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      <Icon size={Math.round(size * 0.5)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
