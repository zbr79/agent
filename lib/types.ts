import type { PendingQuestion } from "./question";
import type { ActivityEvent } from "./markers";
import type { DocumentAttachment } from "./documents/types";
import { MAX_ATTACHMENTS } from "./attachments/limits";

export interface ChatImage {
  mimeType: string;
  data: string;
  name?: string;
}

export interface WorkspaceChanges {
  additions: number;
  deletions: number;
  files: number;
}

export const WORKSPACE_IDS = ["agent", "profile", "inschat", "rencipe"] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export interface WorkspaceInfo {
  id: WorkspaceId;
  label: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  documents?: DocumentAttachment[];
}

/** One persistent opencode thread bound to a chat. Stored as
 * `opencodeSessionId` on the Mongo session or guest run. `tokens` is the
 * prompt size of the last turn (input + cache), the 70% compaction gate. */
export interface AgentBinding {
  sessionId: string;
  tokens: number;
  workspaceId?: WorkspaceId;
}

export interface ConcludeItem {
  name: string;
  value?: string;
  unit?: string;
  number?: number;
}

export interface ConcludeDish {
  name: string;
  rank?: string;
}

export interface ConcludeMeal {
  name: string;
  foods?: string;
  dishes?: ConcludeDish[];
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

export interface ApiCall {
  _id: string;
  kind: "chat" | "conclude" | "health" | "opencode";
  model: string;
  ok: boolean;
  error?: string;
  at: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ChatSession {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: WorkspaceId;
  pinned?: boolean;
}

export type { PendingQuestion, QuestionItem, QuestionOption } from "./question";

export interface StoredMessage {
  _id: string;
  sessionId: string;
  role: "user" | "model";
  text: string;
  images?: ChatImage[];
  documents?: DocumentAttachment[];
  model?: string;
  elapsed?: number;
  createdAt: string;
  /** Server-side run state for model messages; legacy docs default to "done". */
  status?: "pending" | "done" | "failed";
  updatedAt?: string;
  /** Transcript trail (Ran/Read/Edited labels, no leading arrow). */
  processSteps?: string[];
  /** Structured tool/patch activity so cards and the changes summary survive refreshes. */
  activities?: ActivityEvent[];
  /** Open question from the agent; only set while the model message is pending. */
  pendingQuestion?: PendingQuestion | null;
}

export const MAX_MESSAGES = 20;
export { MAX_ATTACHMENTS };
export const MAX_IMAGES = MAX_ATTACHMENTS;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const GUEST_MAX_AUDIO_MS = 60_000;
export const USER_MAX_AUDIO_MS = 180_000;
