"use client";

import { useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { PostVideo } from "@/lib/post-videos";
import ImageLightbox from "./ImageLightbox";

type Slide = { kind: "image"; url: string } | { kind: "video"; video: PostVideo };

// Embeds only ever come from the backend, which builds them from a parsed video ID
// for youtube-nocookie.com / instagram.com — never from admin-typed markup.
function VideoSlide({ video }: { video: PostVideo }) {
  if (video.kind === "file") {
    return (
      <div className="aspect-video w-full bg-black">
        <video src={video.url} controls preload="metadata" playsInline className="h-full w-full object-contain" />
      </div>
    );
  }
  if (!video.embedUrl) return null;
  if (video.kind === "youtube") {
    return (
      <div className="aspect-video w-full bg-black">
        <iframe
          src={video.embedUrl}
          title={video.title ?? "YouTube video"}
          loading="lazy"
          allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full"
        />
      </div>
    );
  }
  // Instagram embeds are portrait and need their full height, so this slide is taller.
  return (
    <div className="flex w-full justify-center bg-background py-3">
      <iframe
        src={video.embedUrl}
        title={video.title ?? "Instagram post"}
        loading="lazy"
        allowFullScreen
        className="h-[560px] w-full max-w-[420px] rounded-xl border border-divider bg-white"
      />
    </div>
  );
}

function Thumbnail({ slide }: { slide: Slide }) {
  if (slide.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={slide.url} alt="" className="h-full w-full object-cover" />;
  }
  const { video } = slide;
  return (
    <span className="relative flex h-full w-full items-center justify-center bg-primary">
      {video.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white">
        {video.kind === "instagram" ? <Camera size={10} /> : <Play size={9} className="ml-px fill-current" />}
      </span>
    </span>
  );
}

/**
 * A post's images and videos as one carousel — images first, then videos, in the order they were
 * added. Only the current slide is mounted, so moving away from a video also stops it playing.
 */
export default function PostMediaCarousel({ imageUrls, videos }: { imageUrls: string[]; videos: PostVideo[] }) {
  const slides: Slide[] = [
    ...imageUrls.map(url => ({ kind: "image" as const, url })),
    // A link that failed to resolve to an embed has nothing to show — leave it out entirely.
    ...videos.filter(v => v.kind === "file" || v.embedUrl).map(video => ({ kind: "video" as const, video })),
  ];
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (slides.length === 0) return null;

  // Slides can be removed while the preview is open (create-post) — never point past the end.
  const current = Math.min(index, slides.length - 1);
  const slide = slides[current]!;
  const hasMultiple = slides.length > 1;
  const goTo = (i: number) => setIndex((i + slides.length) % slides.length);

  return (
    <div className="mt-4">
      <div className="relative w-full overflow-hidden rounded-xl">
        {slide.kind === "image" ? (
          <div className="aspect-video w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.url}
              alt={`Post image ${current + 1}`}
              className="h-full w-full cursor-pointer object-cover"
              onClick={() => setLightboxOpen(true)}
            />
          </div>
        ) : (
          <VideoSlide key={slide.video.id ?? slide.video.url} video={slide.video} />
        )}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              aria-label="Previous"
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => goTo(current + 1)}
              aria-label="Next"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60"
            >
              <ChevronRight size={16} />
            </button>
            <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">
              {current + 1} / {slides.length}
            </span>
            {/* Dots sit over images only — on a video they would cover the player's controls. */}
            {slide.kind === "image" && (
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Go to item ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="mt-2 flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.kind === "image" ? `img:${s.url}:${i}` : `vid:${s.video.id ?? s.video.url}:${i}`}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show ${s.kind === "image" ? "image" : "video"} ${i + 1}`}
              aria-current={i === current ? "true" : undefined}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                i === current ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <Thumbnail slide={s} />
            </button>
          ))}
        </div>
      )}

      {/* Images lead the slide order, so an image slide's index is also its lightbox index. */}
      {lightboxOpen && slide.kind === "image" && (
        <ImageLightbox
          imageUrls={imageUrls}
          index={current}
          onIndexChange={setIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
