import { createOpencodeClient } from "@opencode-ai/sdk";
import { getSystemPrompt } from "./prompt";
import {
  encodeActivityMarker,
  encodeModelMarker,
  encodeQuestionClearMarker,
  encodeQuestionMarker,
  encodeTryingMarker,
  type ActivityStatus,
} from "./markers";
import { insertCall } from "./db";
import { MAX_ATTACHMENTS } from "./attachments/limits";
import { resolveAgentModel, type TextModelPin } from "./models";
import { AGENT_ROOT } from "./pathJail";
import type { AgentBinding, ChatMessage, WorkspaceId } from "./types";
import { DEFAULT_WORKSPACE_ID, workspaceRoot } from "./workspaces";
import {
  agentTurnCancelled,
  cancelAgentTurn,
  claimAgentTurn,
  compactAt,
  FALLBACK_CONTEXT_TOKENS,
  holdAgentTurn,
  inflightSessionFor,
  noteInflightSession,
  ownerTurnBusy,
  releaseAgentTurn,
  seedFromHistory,
  sessionTitleFor,
} from "./agentBind";
import { parseQuestionEvent, parseQuestionToolInput } from "./question";
import type { PendingQuestion } from "./question";

export { AgentBusyError } from "./agentBind";

export class AgentImageUnsupported extends Error {
  constructor() {
    super("Bound agent model cannot attach images.");
    this.name = "AgentImageUnsupported";
  }
}

export class AgentCancelledError extends Error {
  constructor() {
    super("Run stopped by user.");
    this.name = "AgentCancelledError";
  }
}

const AGENT_URL = "http://127.0.0.1:4096";
// Event stream stays open for the whole turn, including pauses on a question card.
const AGENT_EVENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// Frozen while a question card is waiting so a long pause does not fail the turn.
const AGENT_PROMPT_TIMEOUT_MS = 900_000;
// Context window comes from GET /config/providers
// (opencode-go/<model>.limit.context). Compact at 70% of that window by
// starting a fresh session. If the catalog has no window, use a
// conservative 24k cap (compact at 16,800).
const AGENT_PROVIDER_ID = "opencode-go";
const CONFIGURED_MODEL_ID = "gpt-6-luna";

interface OpencodeClient {
  session: {
    create: (input: { query?: { directory: string }; body: { title?: string } }) => Promise<{
      data: { id: string };
    }>;
    get: (input: { query?: { directory: string }; path: { id: string } }) => Promise<{
      data?: { id?: string; title?: string };
    }>;
    prompt: (input: {
      query?: { directory: string };
      path: { id: string };
      body: {
        system?: string;
        agent?: string;
        noReply?: boolean;
        model?: { providerID: string; modelID: string };
        parts: {
          type: string;
          text?: string;
          mime?: string;
          filename?: string;
          url?: string;
        }[];
      };
    }) => Promise<{ data: unknown }>;
    delete: (input: { query?: { directory: string }; path: { id: string } }) => Promise<unknown>;
    abort: (input: { query?: { directory: string }; path: { id: string } }) => Promise<unknown>;
    summarize: (input: {
      path: { id: string };
      body: { providerID: string; modelID: string };
    }) => Promise<unknown>;
    messages: (input: { query?: { directory: string }; path: { id: string } }) => Promise<unknown>;
  };
}

let client: OpencodeClient | null = null;

function directoryQuery(workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID): { directory: string } {
  return { directory: workspaceRoot(workspaceId) };
}

function authHeaders(): Record<string, string> {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) {
    throw new Error("OPENCODE_SERVER_PASSWORD is not configured on the server.");
  }
  return {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  };
}

function getAgentClient(): OpencodeClient {
  if (!client) {
    const created = createOpencodeClient({
      baseUrl: AGENT_URL,
      fetch: (input: RequestInfo | URL, init: RequestInit = {}) =>
        fetch(input, {
          ...init,
          headers: { ...(init.headers || {}), ...authHeaders() },
        }),
    }) as unknown as OpencodeClient;
    client = created;
  }
  return client;
}

interface ProviderModel {
  limit?: { context?: number };
  capabilities?: { attachment?: boolean; input?: { image?: boolean } };
}

export interface AgentModelWindow {
  context: number;
  compactAt: number;
  image: boolean;
  /** Where the window number came from. */
  source: string;
  modelId: string;
}

let windowCache: { at: number; key: string; value: AgentModelWindow } | null = null;

function fallbackWindow(modelId: string): AgentModelWindow {
  return {
    context: FALLBACK_CONTEXT_TOKENS,
    compactAt: compactAt(FALLBACK_CONTEXT_TOKENS),
    image: false,
    source: "fallback-24k (config/providers did not expose limit.context)",
    modelId,
  };
}

export async function lookupAgentModel(modelId = CONFIGURED_MODEL_ID): Promise<AgentModelWindow> {
  const key = modelId || CONFIGURED_MODEL_ID;
  if (windowCache && windowCache.key === key && Date.now() - windowCache.at < 10 * 60_000) {
    return windowCache.value;
  }
  try {
    const response = await fetch(`${AGENT_URL}/config/providers`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return fallbackWindow(key);
    const body = (await response.json()) as {
      providers?: { id?: string; models?: Record<string, ProviderModel> }[];
    };
    const provider = (body.providers ?? []).find((item) => item.id === AGENT_PROVIDER_ID);
    const model = provider?.models?.[key];
    const context = model?.limit?.context;
    if (typeof context !== "number" || !(context > 0)) return fallbackWindow(key);
    const value: AgentModelWindow = {
      context,
      compactAt: compactAt(context),
      image: Boolean(model?.capabilities?.input?.image || model?.capabilities?.attachment),
      source: `GET /config/providers ${AGENT_PROVIDER_ID}/${key} limit.context`,
      modelId: key,
    };
    windowCache = { at: Date.now(), key, value };
    return value;
  } catch {
    return fallbackWindow(key);
  }
}

async function sessionOwnedBy(
  id: string,
  ownerKey: string | null,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<boolean> {
  try {
    const res = await getAgentClient().session.get({
      query: directoryQuery(workspaceId),
      path: { id },
    });
    const data = res?.data;
    if (!data?.id || data.id !== id) return false;
    const title = typeof data.title === "string" ? data.title : "";
    if (title.startsWith("inschat:") && ownerKey && title !== sessionTitleFor(ownerKey)) {
      return false;
    }
    if (title.startsWith("inschat:") && !ownerKey) return false;
    return true;
  } catch {
    return false;
  }
}

function imageFileParts(message: ChatMessage | undefined) {
  return (message?.images ?? []).slice(0, MAX_ATTACHMENTS).map((image, index) => ({
    type: "file",
    mime: image.mimeType,
    filename: `photo-${index + 1}`,
    url: `data:${image.mimeType};base64,${image.data}`,
  }));
}

export async function ensureBoundSession(
  ownerKey: string,
  existingId?: string | null,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<string | null> {
  if (ownerTurnBusy(ownerKey)) return inflightSessionFor(ownerKey) ?? existingId ?? null;
  if (existingId && (await sessionOwnedBy(existingId, ownerKey, workspaceId))) return existingId;
  const created = await getAgentClient().session.create({
    query: directoryQuery(workspaceId),
    body: { title: sessionTitleFor(ownerKey) },
  });
  return created.data.id;
}

export async function isAgentUp(): Promise<boolean> {
  try {
    const response = await fetch(`${AGENT_URL}/global/health`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sessionAlive(id: string): Promise<boolean> {
  try {
    const res = await getAgentClient().session.get({ path: { id } });
    return res?.data?.id === id;
  } catch {
    return false;
  }
}

// Fire-and-forget cleanup when a chat is deleted: the bound opencode session
// should die with it. Safe to call with null.
export async function deleteAgentSession(
  id: string | null | undefined,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  if (!id) return;
  try {
    await getAgentClient().session.delete({ query: directoryQuery(workspaceId), path: { id } });
  } catch {
    /* opencode restart already dropped it */
  }
}

export async function abortAgentSession(
  id: string | null | undefined,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  if (!id) return;
  try {
    await getAgentClient().session.abort({ query: directoryQuery(workspaceId), path: { id } });
  } catch {
    /* already gone */
  }
}

/** Cancel a live turn even when its browser stream has already closed. */
export async function abortAgentTurn(
  ownerKey: string | null | undefined,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  const sessionId = cancelAgentTurn(ownerKey);
  await abortAgentSession(sessionId, workspaceId);
}

export class QuestionExpiredError extends Error {
  constructor(message = "This question expired.") {
    super(message);
    this.name = "QuestionExpiredError";
  }
}

function questionActionUrls(
  requestId: string,
  action: "reply" | "reject",
  sessionId?: string,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): string[] {
  const id = encodeURIComponent(requestId);
  const dir = `directory=${encodeURIComponent(workspaceRoot(workspaceId))}`;
  const urls = [`${AGENT_URL}/question/${id}/${action}?${dir}`];
  if (sessionId) {
    const sid = encodeURIComponent(sessionId);
    urls.push(`${AGENT_URL}/session/${sid}/question/${id}/${action}?${dir}`);
    urls.push(`${AGENT_URL}/api/session/${sid}/question/${id}/${action}?${dir}`);
  }
  return urls;
}

async function postQuestionAction(
  requestId: string,
  action: "reply" | "reject",
  sessionId: string | undefined,
  body?: unknown,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  for (const url of questionActionUrls(requestId, action, sessionId, workspaceId)) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    if (response.status !== 404) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Question ${action} failed (HTTP ${response.status}). ${text.slice(0, 160)}`
      );
    }
  }
  throw new QuestionExpiredError();
}

export async function replyAgentQuestion(
  requestId: string,
  answers: string[][],
  opencodeSessionId?: string,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  await postQuestionAction(requestId, "reply", opencodeSessionId, { answers }, workspaceId);
}

export async function rejectAgentQuestion(
  requestId: string,
  opencodeSessionId?: string,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  await postQuestionAction(requestId, "reject", opencodeSessionId, undefined, workspaceId);
}

// Photo turns go through the direct vision engine (the agent's bound model
// path ignores images). Mirror the exchange into the persistent session with
// a noReply prompt so the next text turn still knows it happened.
export async function injectVisionExchange(
  sessionId: string | null | undefined,
  userText: string,
  assistantText: string,
  workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  if (!sessionId || !assistantText.trim()) return;
  const text =
    `[Vision turn recap] The user sent a photo with: ${userText.slice(0, 2000)}\n` +
    `You replied: ${assistantText.slice(0, 8000)}`;
  try {
    await getAgentClient().session.prompt({
      query: directoryQuery(workspaceId),
      path: { id: sessionId },
      body: { noReply: true, parts: [{ type: "text", text }] },
    });
  } catch {
    /* best effort: a dead bound session rebuilds from the transcript anyway */
  }
}

export interface AgentChatOptions {
  messages: ChatMessage[];
  language?: "zh" | "en";
  agentTools?: boolean;
  mode?: "build" | "plan";
  /** UI-pinned text model; undefined = auto (peak-aware/env default). */
  model?: TextModelPin;
  /** Opencode session bound to this chat, if any. */
  binding?: AgentBinding | null;
  /** Filled in as the run progresses so the caller can persist it. */
  out?: AgentRunResult;
  /** Called once the session id for this turn is settled (created/bound). */
  onSessionReady?: (sessionId: string) => void;
  /** u:userId:chatId or g:guestId. Required to reuse a saved session. */
  ownerKey?: string | null;
  /** Approved project workspace used for this conversation. */
  workspaceId?: WorkspaceId;
  /** Completed turns before the new user message, for rebuild/compact only. */
  priorTurns?: ChatMessage[];
}

export interface AgentRunResult {
  /** Session that served (or will serve) this turn — persist it as the binding. */
  agentSessionId?: string;
  /** Prompt size after this turn (input + cache), the compaction gate. */
  lastInputTokens?: number;
  /** True when this turn re-seeded a full transcript (first turn or rebuild). */
  rebound?: boolean;
}

function buildTranscript(messages: ChatMessage[]): string {
  if (
    messages.length === 1 &&
    messages[0].role === "user" &&
    (messages[0].images?.length ?? 0) === 0 &&
    (messages[0].documents?.length ?? 0) === 0
  ) {
    return messages[0].text;
  }
  const lines = messages.map((message) => {
    const speaker = message.role === "model" ? "Assistant" : "User";
    const markers = [
      (message.images?.length ?? 0) > 0 ? "[photo attached]" : "",
      ...(message.documents ?? []).map(
        (document) => `\n[document attached: ${document.name}]\n${document.text}`
      ),
    ]
      .filter(Boolean)
      .join(" ");
    const content = `${message.text}${markers}`;
    return `${speaker}: ${content}`;
  });
  return `Here is the conversation so far:\n\n${lines.join(
    "\n\n"
  )}\n\nReply as Agent to the last message.`;
}

interface AgentEvent {
  type: string;
  properties?: {
    sessionID?: string;
    info?: { role?: string; model?: { modelID?: string } };
    part?: {
      id?: string;
      type?: string;
      text?: string;
      tool?: string;
      hash?: string;
      files?: string[];
      state?: {
        status?: string;
        title?: string;
        input?: Record<string, unknown>;
        output?: string;
        error?: string;
        metadata?: Record<string, unknown>;
      };
    };
    partID?: string;
    messageID?: string;
    field?: string;
    delta?: string;
    status?: { type?: string };
  };
}


function truncateDetail(text: string, max = 400): string {
  const cleaned = text.replace(/\r/g, "").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function countDiffLines(text: string): { additions?: number; deletions?: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  if (!additions && !deletions) return {};
  return { additions, deletions };
}

/** opencode ≥1.18 edit/write tools return a boilerplate output string; the
 *  real per-edit counts live in state.metadata.filediff{additions,deletions}
 *  (or the unified patch in metadata.diff). Extract them so the UI can show
 *  +N/−N at all. */
function editCountsFromMetadata(
  metadata: Record<string, unknown> | undefined
): { additions?: number; deletions?: number } {
  if (!metadata) return {};
  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const filediff = metadata.filediff;
  if (filediff && typeof filediff === "object") {
    const record = filediff as Record<string, unknown>;
    const added = num(record.additions);
    if (added != null) return { additions: added, deletions: num(record.deletions) ?? 0 };
  }
  if (Array.isArray(metadata.filediffs)) {
    let added = 0;
    let removed = 0;
    let seen = false;
    for (const entry of metadata.filediffs) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const a = num(record.additions);
      const d = num(record.deletions);
      if (a == null && d == null) continue;
      seen = true;
      added += a ?? 0;
      removed += d ?? 0;
    }
    if (seen) return { additions: added, deletions: removed };
  }
  const patch =
    typeof metadata.diff === "string" && metadata.diff
      ? metadata.diff
      : typeof metadata.patch === "string"
        ? metadata.patch
        : "";
  if (patch) return countDiffLines(patch);
  return {};
}

function toolPathFromInput(input: Record<string, unknown>): string {
  return (
    (typeof input.path === "string" && input.path) ||
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof input.file === "string" && input.file) ||
    (typeof input.target === "string" && input.target) ||
    ""
  );
}

function toolCommandFromInput(input: Record<string, unknown>): string {
  return (
    (typeof input.command === "string" && input.command) ||
    (typeof input.cmd === "string" && input.cmd) ||
    ""
  );
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function shortPath(p: string): string {
  const prefix = `${AGENT_ROOT}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** Human-readable process line for the transcript stream (OpenCode-ish log). */
function formatProcessLine(opts: {
  tool?: string;
  path?: string;
  title?: string;
  command?: string;
  status: ActivityStatus;
  additions?: number;
  deletions?: number;
  kind?: string;
}): string {
  const tool = (opts.tool || opts.kind || "step").toLowerCase();
  const target =
    shortPath((opts.path || "").trim()) ||
    shortPath((opts.title || "").trim()) ||
    (opts.command ? truncateDetail(opts.command, 72) : "") ||
    tool;
  let line: string;
  if (tool === "bash" || tool === "shell") {
    line = `→ Ran: ${target}`;
  } else if (
    tool === "edit" ||
    tool === "write" ||
    tool === "apply_patch" ||
    tool === "patch"
  ) {
    line = `→ Edited ${target}`;
  } else if (tool === "read" || tool === "list") {
    line = `→ Read ${target}`;
  } else if (tool === "grep") {
    line = `→ Grep ${target}`;
  } else if (tool === "glob") {
    line = `→ Glob ${target}`;
  } else {
    line = `→ ${capitalizeWord(tool)} ${target}`;
  }
  if (opts.additions != null || opts.deletions != null) {
    line += ` (+${opts.additions ?? 0} -${opts.deletions ?? 0})`;
  } else if (opts.status === "error") {
    line += " ✗";
  } else if (opts.status === "completed" && (tool === "bash" || tool === "shell")) {
    line += " ✓";
  }
  return line;
}


// Streams the agent's answer from the opencode server. Throws before the
// first token if the server is unreachable or the prompt fails — the caller
// falls back to the direct engine in that case.
//
// The opencode session is PERSISTENT per chat: when `binding.sessionId` is
// alive we continue that thread with only the new user message (the model
// keeps its own memory of files, tools and decisions). When the binding is
// missing or the session died (opencode restart), we re-seed a new session
// from a short stored-transcript summary once. The session is never deleted at turn end —
// only deleteAgentSession() (chat deleted) disposes it.
export async function* agentChat(opts: AgentChatOptions): AsyncGenerator<string> {
  const {
    messages,
    language,
    agentTools = false,
    mode = "build",
    model: pinnedModel,
    binding = null,
    out = {},
    onSessionReady,
  } = opts;
  const workspaceId = opts.workspaceId ?? binding?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const directory = directoryQuery(workspaceId);
  const agent = getAgentClient();
  const system = getSystemPrompt(language, agentTools, mode === "plan");
  const requestId = Math.random().toString(36).slice(2, 8);
  const ownerKey = opts.ownerKey ?? null;
  let claimed = false;

  // Claim before any model lookup. Stop can arrive while provider metadata is
  // loading; the owner must already be cancellable during that interval.
  if (ownerKey) {
    claimAgentTurn(ownerKey, AGENT_PROMPT_TIMEOUT_MS);
    claimed = true;
    if (agentTurnCancelled(ownerKey)) {
      releaseAgentTurn(ownerKey);
      claimed = false;
      throw new AgentCancelledError();
    }
  }

  if (process.env.OPENCODE_TEST_LIMIT === "1") {
    if (claimed) releaseAgentTurn(ownerKey);
    throw new Error(
      "Monthly usage limit reached. Resets in 20 days. (test-limit simulation)"
    );
  }

  const prior = opts.priorTurns ?? messages.slice(0, -1);
  const last = messages[messages.length - 1];
  // Resolve the actual model once, up front, so the pin, the context-window
  // gate, and the prompt all agree before we send anything.
  let modelId: string;
  let promptModel: { providerID: string; modelID: string };
  let modelWindow: AgentModelWindow;
  let gate: number;
  let wantsImage: boolean;
  try {
    modelId = resolveAgentModel(pinnedModel);
    promptModel = { providerID: AGENT_PROVIDER_ID, modelID: modelId };
    modelWindow = await lookupAgentModel(modelId);
    gate = modelWindow.compactAt;
    wantsImage = (last?.images?.length ?? 0) > 0;
    if (wantsImage && !modelWindow.image) {
      throw new AgentImageUnsupported();
    }
  } catch (error) {
    if (claimed) releaseAgentTurn(ownerKey);
    throw error;
  }

  let sessionId: string | null = binding?.sessionId ?? null;
  let continued = false;
  let rebound = false;
  const title = ownerKey ? sessionTitleFor(ownerKey) : "inschat";

  async function createBound(): Promise<string> {
    const created = (await agent.session.create({ query: directory, body: { title } })).data.id;
    if (ownerKey) noteInflightSession(ownerKey, created);
    if (agentTurnCancelled(ownerKey)) {
      await abortAgentSession(created, workspaceId);
      throw new AgentCancelledError();
    }
    return created;
  }

  async function seedSession(id: string, reason: "rebuild" | "compact", lostWithoutTranscript: boolean) {
    const seed =
      seedFromHistory(prior, reason) ??
      (lostWithoutTranscript ? seedFromHistory([], "rebuild") : null);
    if (!seed) return;
    await agent.session.prompt({
      query: directory,
      path: { id },
      body: {
        system,
        noReply: true,
        model: promptModel,
        parts: [{ type: "text", text: seed }],
      },
    });
  }

  try {
    if (sessionId) {
      if (ownerKey) noteInflightSession(ownerKey, sessionId);
      const owned = await sessionOwnedBy(sessionId, ownerKey, workspaceId);
      if (owned) {
        continued = true;
        if ((binding?.tokens ?? 0) >= gate) {
          const previous = sessionId;
          console.log(
            `[agent:${requestId}] compacting — prompt ${binding?.tokens ?? 0} >= ${gate} (${modelWindow.source})`
          );
          sessionId = await createBound();
          try {
            await seedSession(sessionId, "compact", false);
          } catch (error) {
            console.log(
              `[agent:${requestId}] compact seed failed → ${String(
                error instanceof Error ? error.message : error
              ).slice(0, 120)}`
            );
          }
          deleteAgentSession(previous, workspaceId).catch(() => {});
          rebound = true;
        }
      } else {
        console.log(`[agent:${requestId}] bound session dead or not owned → rebuild once`);
        sessionId = null;
      }
    }
    if (!sessionId) {
      sessionId = await createBound();
      const hadBinding = Boolean(binding?.sessionId);
      if (prior.length > 0 || hadBinding) {
        try {
          await seedSession(sessionId, "rebuild", hadBinding);
        } catch (error) {
          console.log(
            `[agent:${requestId}] rebuild seed failed → ${String(
              error instanceof Error ? error.message : error
            ).slice(0, 120)}`
          );
        }
        rebound = true;
      }
    }
  } catch (error) {
    if (claimed) releaseAgentTurn(ownerKey);
    throw error;
  }

  if (!sessionId) {
    if (claimed) releaseAgentTurn(ownerKey);
    throw new Error("Agent session was not created.");
  }
  out.agentSessionId = sessionId;
  out.rebound = rebound || !continued;
  onSessionReady?.(sessionId);
  if (agentTurnCancelled(ownerKey)) {
    await abortAgentSession(sessionId, workspaceId);
    if (claimed) releaseAgentTurn(ownerKey);
    claimed = false;
    throw new AgentCancelledError();
  }
  const attachImages = wantsImage && modelWindow.image;
  const documentText = (last?.documents ?? [])
    .map((document) => `\n\nAttached document: ${document.name}\n${document.text}`)
    .join("");
  const promptText =
    `${(last?.text ?? "").trim()}${documentText}`.trim() ||
    (attachImages
      ? "Please look at the attached photo."
      : documentText
        ? "Please review the attached document."
        : "");
  const promptParts = [
    { type: "text", text: promptText },
    ...(attachImages ? imageFileParts(last) : []),
  ];
  // First turn / rebuild: system + this user message. Later turns: new message only.
  const promptSystem = continued && !rebound ? undefined : system;

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const sseResponse = await fetch(
      `${AGENT_URL}/event?${new URLSearchParams(directory).toString()}`,
      {
      headers: authHeaders(),
      signal: AbortSignal.timeout(AGENT_EVENT_TIMEOUT_MS),
      }
    );
    if (!sseResponse.ok || !sseResponse.body) {
      throw new Error(`Agent event stream failed (HTTP ${sseResponse.status}).`);
    }

    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let produced = false;
    let modelName: string | null = null;
    let toolHits = new Set<string>();
    let toolStatus = new Map<string, ActivityStatus>();
    const mirroredKeys = new Set<string>();
    const changedFiles: string[] = [];
    const seenChanged = new Set<string>();
    let buildOk: boolean | null = null;
    let idle = false;
    let failed: Error | null = null;
    let promptSettled = false;
    const partTypes = new Map<string, string>();
    let awaitingQuestion = false;
    const askedIds = new Set<string>();
    let promptDeadline = Date.now() + AGENT_PROMPT_TIMEOUT_MS;

    const bumpPromptDeadline = () => {
      promptDeadline = Date.now() + AGENT_PROMPT_TIMEOUT_MS;
    };

    const noteQuestionAsked = function* (asked: PendingQuestion, fromEvent = false) {
      if (!fromEvent && awaitingQuestion) return;
      if (askedIds.has(asked.requestId) && awaitingQuestion) return;
      askedIds.add(asked.requestId);
      awaitingQuestion = true;
      if (ownerKey) holdAgentTurn(ownerKey, true);
      yield encodeQuestionMarker(asked);
      const header = asked.questions[0]?.header;
      if (header) yield encodeTryingMarker(header.slice(0, 60));
      console.log(`[agent:${requestId}] question asked ${asked.requestId}`);
    };

    const noteQuestionClosed = function* (closedId: string) {
      awaitingQuestion = false;
      if (ownerKey) holdAgentTurn(ownerKey, false);
      bumpPromptDeadline();
      if (closedId) yield encodeQuestionClearMarker(closedId);
    };

    const readEvents = (async function* () {
      try {
        while (true) {
          // Stall breaker: once the prompt has settled, stop waiting for the
          // SSE stream if nothing arrives for 20s — the fallback below pulls
          // the finished message parts directly.
          const readPromise = reader.read();
          let value: Uint8Array | undefined;
          let done = false;
          if (promptSettled && !awaitingQuestion) {
            const result = await Promise.race([
              readPromise,
              new Promise<"stalled">((resolve) =>
                setTimeout(() => resolve("stalled"), 20_000)
              ),
            ]);
            if (result === "stalled") {
              break;
            }
            ({ done, value } = result as { done: boolean; value: Uint8Array | undefined });
          } else {
            ({ done, value } = await readPromise);
          }
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            let event: AgentEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as AgentEvent;
            } catch {
              continue;
            }
            const props = event.properties ?? {};
            if (props.sessionID && props.sessionID !== sessionId) continue;

            const asked = parseQuestionEvent(
              event.type,
              props as Record<string, unknown>,
              sessionId
            );
            if (asked) {
              yield* noteQuestionAsked(asked, true);
              continue;
            }
            const typeLower = event.type.toLowerCase();
            if (
              typeLower.includes("question") &&
              (typeLower.includes("replied") || typeLower.includes("rejected"))
            ) {
              const rec = props as Record<string, unknown>;
              const closedId =
                (typeof rec.requestID === "string" && rec.requestID) ||
                (typeof rec.requestId === "string" && rec.requestId) ||
                (typeof rec.id === "string" && rec.id) ||
                "";
              yield* noteQuestionClosed(closedId);
              continue;
            }

            if (event.type === "message.updated") {
              const info = props.info;
              if (info?.role === "assistant" && info.model?.modelID) {
                modelName = info.model.modelID;
              }
            } else if (event.type === "message.part.delta" && props.field === "text") {
              const partType = partTypes.get(props.partID ?? "");
              if (props.delta && partType === "text") {
                if (!produced) {
                  produced = true;
                  yield encodeModelMarker(modelName ?? modelId);
                  console.log(`[agent:${requestId}] first token (model ${modelName})`);
                }
                yield props.delta;
              }
            } else if (event.type === "message.part.updated") {
              const part = props.part;
              if (part?.id && part?.type) {
                partTypes.set(part.id, part.type);
              }
              if (part?.type === "patch") {
                const patchKey = part.id || `patch:${part.hash || "files"}`;
                const files = Array.isArray(part.files) ? part.files.filter((f) => typeof f === "string") : [];
                const title = files.length === 1 ? files[0] : files.length ? `${files.length} files` : "patch";
                const last = toolStatus.get(patchKey);
                if (last !== "completed") {
                  toolStatus.set(patchKey, "completed");
                  for (const f of files) {
                    if (f && !seenChanged.has(f)) {
                      seenChanged.add(f);
                      changedFiles.push(f);
                    }
                  }
                  yield encodeActivityMarker({
                    id: patchKey,
                    kind: "patch",
                    tool: "patch",
                    title,
                    path: files[0],
                    status: "completed",
                    detail: files.length ? files.join(", ") : undefined,
                    output: files.length ? files.map((f) => `• ${f}`).join("\n") : undefined,
                  });
                  if (!produced) {
                    produced = true;
                    yield encodeModelMarker(modelName ?? modelId);
                  }
                  if (!mirroredKeys.has(patchKey)) {
                    mirroredKeys.add(patchKey);
                    yield `\n${formatProcessLine({
                      tool: "patch",
                      path: files[0],
                      title,
                      status: "completed",
                      kind: "patch",
                    })}\n`;
                  }
                  console.log(`[agent:${requestId}] patch ${title}`);
                }
              }
              if (part?.type === "tool") {
                const toolKey = part.id || part.tool || "tool";
                const rawStatus = part.state?.status || "";
                let activityStatus: ActivityStatus | null = null;
                if (rawStatus === "pending" || rawStatus === "running") {
                  activityStatus = "running";
                } else if (rawStatus === "completed") {
                  activityStatus = "completed";
                } else if (rawStatus === "error") {
                  activityStatus = "error";
                }
                const input = part.state?.input ?? {};
                const pathish = toolPathFromInput(input);
                const command = toolCommandFromInput(input);
                const toolName = (part.tool || "tool").toLowerCase();
                if (toolName === "question") {
                  if (activityStatus === "running") {
                    const meta = part.state?.metadata ?? {};
                    const toolRequestId =
                      (typeof meta.requestID === "string" && meta.requestID) ||
                      (typeof meta.requestId === "string" && meta.requestId) ||
                      (typeof input.requestID === "string" && input.requestID) ||
                      (typeof input.requestId === "string" && input.requestId) ||
                      part.id ||
                      "";
                    const fromTool = parseQuestionToolInput(
                      input,
                      toolRequestId,
                      sessionId
                    );
                    if (fromTool) yield* noteQuestionAsked(fromTool);
                  }
                  continue;
                }
                const isDeferredRestart =
                  (toolName === "bash" || toolName === "shell") &&
                  /restart-agent-deferred\.sh/.test(command);
                if (isDeferredRestart && activityStatus === "error") {
                  activityStatus = "completed";
                }
                if (
                  (toolName === "bash" || toolName === "shell") &&
                  /npm\s+run\s+build/.test(command)
                ) {
                  if (activityStatus === "completed") buildOk = true;
                  else if (activityStatus === "error") buildOk = false;
                }
                if (
                  activityStatus === "completed" &&
                  (toolName === "edit" ||
                    toolName === "write" ||
                    toolName === "apply_patch" ||
                    toolName === "patch") &&
                  pathish &&
                  !seenChanged.has(pathish)
                ) {
                  seenChanged.add(pathish);
                  changedFiles.push(pathish);
                }
                const title =
                  pathish ||
                  (part.state?.title && String(part.state.title)) ||
                  (command ? command.slice(0, 80) : "") ||
                  undefined;
                const outputRaw =
                  typeof part.state?.output === "string" ? part.state.output : "";
                const errorRaw =
                  typeof part.state?.error === "string" ? part.state.error : "";
                const isEditTool =
                  toolName === "edit" ||
                  toolName === "write" ||
                  toolName === "apply_patch" ||
                  toolName === "patch";
                let detail: string | undefined =
                  pathish || (command ? truncateDetail(command, 120) : undefined);
                let output: string | undefined;
                let additions: number | undefined;
                let deletions: number | undefined;
                if (activityStatus === "completed" || activityStatus === "error") {
                  const body = activityStatus === "error" ? errorRaw || outputRaw : outputRaw;
                  const bodyIsPatch =
                    Boolean(body) &&
                    (body.includes("\n+") ||
                      body.includes("\n-") ||
                      body.startsWith("---") ||
                      body.startsWith("@@"));
                  if (body) {
                    output = truncateDetail(body, isEditTool ? 6000 : 600);
                    if (isEditTool || bodyIsPatch) {
                      const counts = countDiffLines(body);
                      additions = counts.additions;
                      deletions = counts.deletions;
                    }
                    if (isEditTool && !detail) detail = pathish || title;
                    if (!isEditTool && command) {
                      detail = truncateDetail(command, 160);
                    } else if (!isEditTool && body && !pathish) {
                      detail = truncateDetail(body.split("\n")[0] || body, 120);
                    }
                  } else if (isEditTool && pathish) {
                    detail = `edited ${pathish}`;
                  }
                  if (isEditTool && activityStatus === "completed") {
                    const meta = part.state?.metadata;
                    if (additions == null && deletions == null) {
                      const counts = editCountsFromMetadata(meta);
                      additions = counts.additions;
                      deletions = counts.deletions;
                    }
                    // The write tool exposes no diff; for brand-new files the
                    // whole content counts as added lines.
                    if (
                      additions == null &&
                      deletions == null &&
                      toolName === "write" &&
                      meta?.exists === false &&
                      typeof input.content === "string" &&
                      input.content
                    ) {
                      const lines = input.content.split("\n");
                      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
                      additions = lines.length;
                      deletions = 0;
                    }
                    // "Edit applied successfully." is noise — show the real diff
                    // in the expandable detail when the output had none.
                    if (!bodyIsPatch && typeof meta?.diff === "string" && meta.diff) {
                      output = truncateDetail(meta.diff, 6000);
                    }
                  }
                }
                if (activityStatus) {
                  const last = toolStatus.get(toolKey);
                  // Re-emit on completed/error even if status unchanged so richer
                  // output/diff can replace a bare running→completed stub.
                  const richer =
                    (activityStatus === "completed" || activityStatus === "error") &&
                    (output || additions != null || deletions != null);
                  if (last !== activityStatus || richer) {
                    toolStatus.set(toolKey, activityStatus);
                    yield encodeActivityMarker({
                      id: toolKey,
                      kind: "tool",
                      tool: part.tool || "tool",
                      title,
                      path: pathish || undefined,
                      status: activityStatus,
                      detail,
                      output,
                      additions,
                      deletions,
                    });
                    // Mirror completed/error tools into the transcript as process lines
                    // so the center pane narrates work even if the Activity rail is ignored.
                    if (activityStatus === "completed" || activityStatus === "error") {
                      if (!produced) {
                        produced = true;
                        yield encodeModelMarker(modelName ?? modelId);
                      }
                      if (!mirroredKeys.has(toolKey)) {
                        mirroredKeys.add(toolKey);
                        yield `\n${formatProcessLine({
                          tool: part.tool || "tool",
                          path: pathish || undefined,
                          title,
                          command: command || undefined,
                          status: activityStatus,
                          additions,
                          deletions,
                        })}\n`;
                      }
                    }
                    console.log(
                      `[agent:${requestId}] tool ${part.tool} (${activityStatus}) ${title ?? ""}`.trim()
                    );
                  }
                }
                // Keep TRYING chips for older UI paths / processSteps trail.
                if (
                  activityStatus === "running" &&
                  toolKey &&
                  !toolHits.has(toolKey)
                ) {
                  toolHits.add(toolKey);
                  const label = title || part.tool || "tool";
                  yield encodeTryingMarker(`${label}`.slice(0, 60));
                }
              }
            } else if (event.type === "session.idle") {
              if (!awaitingQuestion) {
                idle = true;
                break;
              }
            }
          }
          if (idle) break;
        }
      } catch (error) {
        failed = error instanceof Error ? error : new Error(String(error));
      }
    })();

    // Start the prompt without blocking the event pump. Previously we
    // awaited prompt settlement first, which meant TRYING markers and
    // tokens only flushed after tools finished — the UI stuck on
    // "Working…" with no chips for the whole wait.
    // Timestamp just before the prompt (small skew allowance) — used by the
    // direct-pull fallback to tell THIS turn's answer from the thread's
    // history when the event stream stalls mid-run.
    const turnStartedAt = Date.now() - 1_500;
    const promptPromise = agent.session.prompt({
      query: directory,
      path: { id: sessionId },
      body: {
        system: promptSystem,
        agent: mode === "plan" ? "plan" : undefined,
        model: promptModel,
        parts: promptParts,
      },
    });

    interface PromptInfo {
      cost?: number;
      modelID?: string;
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        total?: number;
        cache?: { read?: number; write?: number };
      };
    }

    type PromptResult =
      | { status: "ok"; info: PromptInfo | undefined }
      | { status: "error"; info: undefined };

    let promptResult: PromptResult | null = null;
    const promptResultPromise: Promise<PromptResult> = Promise.race([
      promptPromise,
      new Promise<never>((_, reject) => {
        const tick = () => {
          if (awaitingQuestion) {
            timeoutTimer = setTimeout(tick, 10_000);
            return;
          }
          const left = promptDeadline - Date.now();
          if (left <= 0) {
            reject(
              new Error(
                `Agent prompt timed out after ${AGENT_PROMPT_TIMEOUT_MS / 1000}s.`
              )
            );
            return;
          }
          timeoutTimer = setTimeout(tick, Math.min(left, 10_000));
        };
        timeoutTimer = setTimeout(tick, 10_000);
      }),
    ])
      .then(
        (result) =>
          ({
            status: "ok" as const,
            info: (result as { data?: { info?: PromptInfo } }).data?.info,
          }) satisfies PromptResult
      )
      .catch((error: unknown) => {
        failed = error instanceof Error ? error : new Error(String(error));
        return { status: "error" as const, info: undefined } satisfies PromptResult;
      })
      .then((result) => {
        promptResult = result;
        promptSettled = true;
        return result;
      });

    // Yield SSE chunks to the client while the prompt is still running.
    for await (const text of readEvents) {
      yield text;
    }

    const settledResult: PromptResult =
      promptResult ?? (await promptResultPromise);
    promptResult = settledResult;

    if (agentTurnCancelled(ownerKey)) {
      throw new AgentCancelledError();
    }

    // The event stream often delivers the first token before message.updated
    // (which carries the model id), leaving modelName null — the UI chip and
    // persisted message would then show the fallback label. Emit a corrected
    // marker once the real model is known so the client keeps the last one.
    if (!modelName && promptResult.status === "ok" && promptResult.info?.modelID) {
      modelName = promptResult.info.modelID;
      yield encodeModelMarker(modelName);
      console.log(`[agent:${requestId}] model corrected → ${modelName}`);
    }

    // Fallback: if the event stream never delivered the answer, pull the
    // finished message parts directly from the session. On a persistent
    // session only accept entries created during THIS turn (the thread
    // already contains earlier turns' answers).
    if (!produced && promptResult.status === "ok") {
      try {
        const list = (await agent.session.messages({
          query: directory,
          path: { id: sessionId },
        })) as {
          data?: {
            info?: { role?: string; modelID?: string; time?: { created?: number } };
            parts?: { type?: string; text?: string }[];
          }[];
        };
        const entries = list.data ?? [];
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.info?.role !== "assistant") continue;
          const created = entry.info?.time?.created ?? 0;
          if (continued && created && created < turnStartedAt) continue;
          const textParts = (entry.parts ?? [])
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text as string);
          if (textParts.length === 0) continue;
          modelName = entry.info?.modelID ?? modelName;
          produced = true;
          yield encodeModelMarker(modelName ?? modelId);
          for (const partText of textParts) {
            yield partText;
          }
          console.log(
            `[agent:${requestId}] stream stalled — pulled ${textParts.length} text parts directly`
          );
          break;
        }
      } catch (error) {
        console.log(
          `[agent:${requestId}] fallback fetch failed → ${String(
            error instanceof Error ? error.message : error
          ).slice(0, 120)}`
        );
      }
    }

    if (promptResult.status === "error" && !produced) {
      const failure = failed ?? new Error("Agent prompt failed.");
      console.log(
        `[agent:${requestId}] prompt failed before first token → ${failure.message.slice(0, 160)}`
      );
      // Poisoned thread risk: a prompt that died mid-flight can leave the
      // bound session busy or half-spoken. Best-effort abort; the caller
      // unbinds on this error so the next turn re-seeds a clean session.
      agent.session.abort({ query: directory, path: { id: sessionId } }).catch(() => {});
      insertCall({
        kind: "opencode",
        model: modelName ?? modelId,
        ok: false,
        error: failure.message.slice(0, 300),
      }).catch(() => {});
      throw failure;
    }
    if (!produced && failed) {
      agent.session.abort({ query: directory, path: { id: sessionId } }).catch(() => {});
      throw failed;
    }
    if (!produced) {
      agent.session.abort({ query: directory, path: { id: sessionId } }).catch(() => {});
      throw new Error("Agent finished without producing an answer.");
    }
    const info = promptResult.info;
    const tokens = info?.tokens;
    const normalized = tokens
      ? {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          reasoning: tokens.reasoning ?? 0,
          cacheRead: tokens.cache?.read ?? 0,
          cacheWrite: tokens.cache?.write ?? 0,
        }
      : undefined;
    // Total prompt size this turn saw — the caller stores it as the binding's
    // compaction gate for the next turn.
    out.lastInputTokens = normalized
      ? normalized.input + normalized.cacheRead + normalized.cacheWrite
      : undefined;
    // Structured completion summary into the text stream (Activity rail may
    // be off). No "Done" header — the client renders a green end-rule.
    {
      const lines: string[] = [];
      if (changedFiles.length) {
        lines.push(`- Files changed: ${changedFiles.join(", ")}`);
      }
      if (buildOk === true) {
        lines.push("- Build: ok");
      } else if (buildOk === false) {
        lines.push("- Build: failed");
      }
      if (lines.length) {
        yield `\n${lines.join("\n")}\n`;
      }
    }
    insertCall({
      kind: "opencode",
      model: info?.modelID ?? modelName ?? modelId,
      ok: true,
      cost: info?.cost,
      tokens: normalized,
    }).catch(() => {});
    console.log(
      `[agent:${requestId}] done — answered by agent (${info?.modelID ?? modelName ?? "default"}), cost ${info?.cost ?? "n/a"}`
    );
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (ownerKey) holdAgentTurn(ownerKey, false);
    // The bound opencode session outlives this turn. It is disposed by
    // deleteAgentSession() when the chat is deleted. Unbound one-shot
    // requests (no chat id) are deleted so they cannot be reused.
    if (claimed) releaseAgentTurn(ownerKey);
    else if (!ownerKey && sessionId) deleteAgentSession(sessionId, workspaceId).catch(() => {});
  }
}
