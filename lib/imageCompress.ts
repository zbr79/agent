import type { ChatImage } from "./types";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = src;
  });
}

// Downscale to max 1600px and re-encode as JPEG q85. Photos from modern
// phones are usually 3000-4000px — vision models resize internally anyway,
// so the pixels above 1600px cost tokens without adding readability.
export async function compressImage(
  image: ChatImage
): Promise<ChatImage> {
  if (!image.data) return image;
  const img = await loadImage(`data:${image.mimeType};base64,${image.data}`);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  if (scale >= 1) return image; // already small enough — keep original
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(img, 0, 0, width, height);
  const data = canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
  return { mimeType: "image/jpeg", data };
}