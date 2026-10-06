import ReactMarkdown from "react-markdown";

/** Renders markdown the way the mobile app will. react-markdown never renders raw HTML. */
export default function MarkdownView({ markdown, className = "" }: { markdown: string; className?: string }) {
  return (
    <div
      className={`text-sm leading-relaxed text-[#5a6a60] [&_p]:my-1.5 [&_strong]:font-bold [&_strong]:text-primary [&_em]:italic [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline ${className}`}
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
