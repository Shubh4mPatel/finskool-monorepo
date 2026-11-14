"use client";

import { useEffect, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { PostVideo } from "@/lib/post-videos";
import ImageLightbox from "./ImageLightbox";

type Slide = { kind: "image"; url: string } | { kind: "video"; video: PostVideo };

// Same numbers the mobile app uses (docs/mobile-post-media-layout.md), so this preview matches what members see.
const MIN_RATIO = 0.8; // 4:5, the tallest frame allowed
const MAX_RATIO = 1.91; // the widest frame allowed
const DEFAULT_RATIO = 16 / 9;
const CLOSE_ENOUGH = 0.15; // within 15% of the frame's ratio -> cover; further away -> contain on a blurred backdrop

const COMMON_RATIOS: [number, string][] = [
  [0.8, "4:5"],
  [0.75, "3:4"],
  [1, "1:1"],
  [4 / 3, "4:3"],
  [16 / 9, "16:9"],
  [1.91, "1.91:1"],
];

function ratioLabel(r: number): string {
  const hit = COMMON_RATIOS.find(([v]) => Math.abs(v - r) < 0.015);
  return hit ? hit[1] : r.toFixed(2);
}

type Fit = "cover" | "contain";

function fitFor(frame: number, itemRatio: number | null | undefined): Fit {
  if (!itemRatio) return "cover";
  return Math.abs(itemRatio - frame) / frame < CLOSE_ENOUGH ? "cover" : "contain";
}

function videoRatio(v: PostVideo): number | null {
  if (v.kind !== "file") return null;
  if (v.ratio) return v.ratio;
  return v.width && v.height ? v.width / v.height : null;
}

/** The post's frame: the first sized image, else the first uploaded video; links fall back to their player's shape. */
function frameRatioOf(imageUrls: string[], videos: PostVideo[], imageRatio: (url: string) => number | null): number {
  const fromImage = imageUrls.map(imageRatio).find((r): r is number => r !== null);
  const fromVideo = videos.map(videoRatio).find((r): r is number => r !== null);
  const r = fromImage ?? fromVideo;
  if (r) return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
  const linksOnly = imageUrls.length === 0 && videos.length > 0 && videos.every(v => v.kind === "instagram");
  return linksOnly ? MIN_RATIO : DEFAULT_RATIO;
}

// Embeds only ever come from the backend, which builds them from a parsed video ID
// for youtube-nocookie.com / instagram.com — never from admin-typed markup.
function VideoSlide({ video, frame }: { video: PostVideo; frame: number }) {
  if (video.kind === "file") {
    const fit = fitFor(frame, videoRatio(video));
    return (
      <div className="h-full w-full bg-black">
        <video
          src={video.url}
          poster={video.thumbnailUrl ?? undefined}
          controls
          preload="metadata"
          playsInline
          className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
        />
      </div>
    );
  }
  if (!video.embedUrl) return null;
  if (video.kind === "youtube") {
    // A 16:9 player centred in the frame, as large as fits.
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <iframe
          src={video.embedUrl}
          title={video.title ?? "YouTube video"}
          loading="lazy"
          allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className={`aspect-video ${frame >= DEFAULT_RATIO ? "h-full" : "w-full"}`}
        />
      </div>
    );
  }
  // Instagram embeds are 4:5 portrait; the frame is never narrower than 4:5, so full height always fits.
  return (
    <div className="flex h-full w-full justify-center bg-background">
      <iframe
        src={video.embedUrl}
        title={video.title ?? "Instagram post"}
        loading="lazy"
        allowFullScreen
        className="aspect-[4/5] h-full max-w-full border-0 bg-white"
      />
    </div>
  );
}

function ImageSlide({ url, alt, fit, onOpen }: { url: string; alt: string; fit: Fit; onOpen: () => void }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-black/5">
      {fit === "contain" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className={`relative h-full w-full cursor-pointer ${fit === "cover" ? "object-cover" : "object-contain"}`}
        onClick={onOpen}
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
export default function PostMediaCarousel({
  imageUrls,
  videos,
  imageRatios,
}: {
  imageUrls: string[];
  videos: PostVideo[];
  // url -> width / height when the server already knows it; anything missing is measured in the browser.
  imageRatios?: Record<string, number | null>;
}) {
  const slides: Slide[] = [
    ...imageUrls.map(url => ({ kind: "image" as const, url })),
    // A link that failed to resolve to an embed has nothing to show — leave it out entirely.
    ...videos.filter(v => v.kind === "file" || v.embedUrl).map(video => ({ kind: "video" as const, video })),
  ];
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [measured, setMeasured] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    for (const url of imageUrls) {
      if (imageRatios?.[url] || measured[url]) continue;
      const probe = new window.Image();
      probe.onload = () => {
        if (!cancelled && probe.naturalWidth && probe.naturalHeight) {
          setMeasured(m => ({ ...m, [url]: probe.naturalWidth / probe.naturalHeight }));
        }
      };
      probe.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [imageUrls, imageRatios, measured]);

  if (slides.length === 0) return null;

  // Slides can be removed while the preview is open (create-post) — never point past the end.
  const current = Math.min(index, slides.length - 1);
  const slide = slides[current]!;
  const hasMultiple = slides.length > 1;
  const goTo = (i: number) => setIndex((i + slides.length) % slides.length);

  const imageRatio = (url: string) => imageRatios?.[url] || measured[url] || null;
  const frame = frameRatioOf(imageUrls, videos, imageRatio);
  const slideRatio = slide.kind === "image" ? imageRatio(slide.url) : videoRatio(slide.video);
  const fit = fitFor(frame, slideRatio);

  return (
    <div className="mt-4">
      {/* Phone-width frame: the same shape the mobile app draws, so the admin sees what members see. */}
      <div className="mx-auto w-full max-w-[400px]">
      <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: frame }}>
        {slide.kind === "image" ? (
          <ImageSlide url={slide.url} alt={`Post image ${current + 1}`} fit={fit} onOpen={() => setLightboxOpen(true)} />
        ) : (
          <VideoSlide key={slide.video.id ?? slide.video.url} video={slide.video} frame={frame} />
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
      <p className="mt-1.5 text-center text-[11px] text-muted">
        Mobile app view · {ratioLabel(frame)} frame
        {slideRatio && fit === "contain" && ` · this ${ratioLabel(slideRatio)} item is shown whole on a blurred background`}
        {slideRatio && fit === "cover" && Math.abs(slideRatio - frame) / frame > 0.01 && " · a thin edge may be trimmed"}
      </p>
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
