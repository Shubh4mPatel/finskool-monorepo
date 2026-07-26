export default function CommunityBadgeIcon({
  badgeUrl,
  className = "inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em]",
}: {
  badgeUrl?: string | null;
  className?: string;
}) {
  if (!badgeUrl) return <>⚡</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={badgeUrl} alt="" className={className} />;
}
