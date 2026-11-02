// Community covers and service thumbnails are shown as wide cards, so they must all be 5:2 (2.5 : 1).
// The server checks the stored file again; this just tells the admin before anything is uploaded.
export const BANNER_RATIO = 5 / 2;
export const BANNER_HINT = "5:2 ratio, e.g. 1500 × 600 px";
const TOLERANCE = 0.01; // a pixel of rounding is fine

/** Reads the size the image is displayed at (the browser applies EXIF rotation). */
function sizeOf(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** null if the image has a 5:2 ratio, else the message to show (with the size that was chosen). */
export async function checkBannerRatio(file: File, what: string): Promise<string | null> {
  const size = await sizeOf(file);
  if (!size) return `"${file.name}" could not be read as an image.`;
  if (Math.abs(size.width / size.height - BANNER_RATIO) / BANNER_RATIO > TOLERANCE) {
    return `The ${what} must have a 5:2 ratio (for example 1500 × 600 px). This image is ${size.width} × ${size.height}.`;
  }
  return null;
}
