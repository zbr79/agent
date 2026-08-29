export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  image?: ChatImage;
}

export interface ConcludeItem {
  name: string;
  value?: string;
  unit?: string;
  number?: number;
}

export interface ConcludeMeal {
  name: string;
  foods?: string;
  time?: string;
}

export interface ConcludeResult {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
}

export interface SessionConclusion {
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  sourceText?: string;
}

export interface SavedRecord {
  _id: string;
  title: string;
  summary: string;
  items: ConcludeItem[];
  meals?: ConcludeMeal[];
  sourceText?: string;
  savedAt: string;
  datetime: string | null;
}

export interface ApiCall {
  _id: string;
  kind: "chat" | "conclude" | "health";
  model: string;
  ok: boolean;
  error?: string;
  at: string;
}

export interface ChatSession {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  _id: string;
  sessionId: string;
  role: "user" | "model";
  text: string;
  image?: ChatImage;
  model?: string;
  elapsed?: number;
  createdAt: string;
}

export const MAX_MESSAGES = 20;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
