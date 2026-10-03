import type { PostVideo } from "@/lib/post-videos";

// Embeds only ever come from the backend, which builds them from a parsed video ID
// for youtube-nocookie.com / instagram.com — never from admin-typed markup.
export default function PostVideoList({ videos }: { videos: PostVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {videos.map((v) => {
        const key = v.id ?? v.url;
        if (v.kind === "file") {
          return (
            <video
              key={key}
              src={v.url}
              controls
              preload="metadata"
              playsInline
              className="max-h-[420px] w-full rounded-xl bg-black"
            />
          );
        }
        if (!v.embedUrl) return null;
        return v.kind === "youtube" ? (
          <div key={key} className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              src={v.embedUrl}
              title={v.title ?? "YouTube video"}
              loading="lazy"
              allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full"
            />
          </div>
        ) : (
          <iframe
            key={key}
            src={v.embedUrl}
            title={v.title ?? "Instagram post"}
            loading="lazy"
            allowFullScreen
            className="mx-auto h-[560px] w-full max-w-[420px] rounded-xl border border-divider bg-white"
          />
        );
      })}
    </div>
  );
}
