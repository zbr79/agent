export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  image?: ChatImage;
}

export const MAX_MESSAGES = 20;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
