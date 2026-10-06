import ReactMarkdown from "react-markdown";

const SIZES = { sm: "text-sm leading-relaxed", xs: "text-[11px] leading-snug" } as const;
const TONES = {
  default: "text-[#5a6a60] [&_strong]:text-primary",
  amber: "text-amber-800 [&_strong]:text-amber-900",
  red: "text-red-600 [&_strong]:text-red-700",
} as const;

/** Renders markdown the way the mobile app will. react-markdown never renders raw HTML. */
export default function MarkdownView({
  markdown,
  size = "sm",
  tone = "default",
  className = "",
}: {
  markdown: string;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <div
      className={`${SIZES[size]} ${TONES[tone]} [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_em]:italic [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline ${className}`}
    >
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
