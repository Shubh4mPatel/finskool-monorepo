import { API_URL, ApiError, refreshSession } from "@/lib/api";

export type MediaOrientation = "portrait" | "landscape";

/** One file as measured and stored by POST /api/v1/posts/media. */
export interface UploadedMedia {
  kind: "image" | "video";
  name: string;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  ratio: number;
  orientation: MediaOrientation;
  durationSec: number | null;
}

/** Size info kept per uploaded url so the picker can show how the post will be laid out. */
export interface MediaShape {
  width: number;
  height: number;
  ratio: number;
  orientation: MediaOrientation;
}

/** "Portrait · 400×800 (0.5)" for the chip on the lead item. */
export function describeShape(s: MediaShape): string {
  return `${s.orientation === "portrait" ? "Portrait" : "Landscape"} · ${s.width}×${s.height} (${Number(s.ratio.toFixed(2))})`;
}

function send(files: File[], onProgress?: (pct: number) => void): Promise<{ status: number; body: { data?: UploadedMedia[]; message?: string; code?: string } }> {
  // XHR rather than fetch so a big video can report progress.
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/v1/posts/media`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON (e.g. a proxy 413 page) */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}

/**
 * Uploads images and/or videos in one request. The server decides the type from the content, stores the files as
 * they are, and returns each one's real size, ratio and orientation (plus a poster for videos).
 */
export async function uploadPostMedia(files: File[], onProgress?: (pct: number) => void): Promise<UploadedMedia[]> {
  let res = await send(files, onProgress);
  if (res.status === 401 && (await refreshSession())) res = await send(files, onProgress);
  if (res.status === 413) throw new ApiError(413, "The server rejected the upload as too large.");
  if (res.status < 200 || res.status >= 300 || !res.body.data) {
    throw new ApiError(res.status, res.body.message ?? "Upload failed", res.body.code);
  }
  return res.body.data;
}
