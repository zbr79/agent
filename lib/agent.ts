import { createOpencodeClient } from "@opencode-ai/sdk";
import { getSystemPrompt } from "./prompt";
import { encodeModelMarker, encodeTryingMarker } from "./markers";
import { insertCall } from "./db";
import type { ChatMessage } from "./types";

const AGENT_URL = "http://127.0.0.1:4096";
const AGENT_TIMEOUT_MS = 300_000;

interface OpencodeClient {
  session: {
    create: (input: { body: { title?: string } }) => Promise<{
      data: { id: string };
    }>;
    prompt: (input: {
      path: { id: string };
      body: { system?: string; parts: { type: string; text?: string }[] };
    }) => Promise<{ data: unknown }>;
    delete: (input: { path: { id: string } }) => Promise<unknown>;
    messages: (input: { path: { id: string } }) => Promise<unknown>;
  };
}

let client: OpencodeClient | null = null;

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

function buildTranscript(messages: ChatMessage[]): string {
  if (
    messages.length === 1 &&
    messages[0].role === "user" &&
    (messages[0].images?.length ?? 0) === 0
  ) {
    return messages[0].text;
  }
  const lines = messages.map((message) => {
    const speaker = message.role === "model" ? "Assistant" : "User";
    const content =
      (message.images?.length ?? 0) > 0
        ? `${message.text} [photo attached]`
        : message.text;
    return `${speaker}: ${content}`;
  });
  return `Here is the conversation so far:\n\n${lines.join(
    "\n\n"
  )}\n\nReply as InsChat to the last message.`;
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
      state?: { status?: string; title?: string };
    };
    partID?: string;
    messageID?: string;
    field?: string;
    delta?: string;
    status?: { type?: string };
  };
}

// Streams the agent's answer from the opencode server. Throws before the
// first token if the server is unreachable or the prompt fails — the caller
// falls back to the direct engine in that case.
export async function* agentChat(
  messages: ChatMessage[],
  timeZone?: string,
  language?: "zh" | "en",
  freeMode = false
): AsyncGenerator<string> {
  const agent = getAgentClient();
  const session = (await agent.session.create({ body: { title: "inschat" } })).data;
  const system = getSystemPrompt(timeZone, language, freeMode);
  const requestId = Math.random().toString(36).slice(2, 8);

  if (process.env.OPENCODE_TEST_LIMIT === "1") {
    agent.session.delete({ path: { id: session.id } }).catch(() => {});
    throw new Error(
      "Monthly usage limit reached. Resets in 20 days. (test-limit simulation)"
    );
  }

  try {
    const sseResponse = await fetch(`${AGENT_URL}/event`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    if (!sseResponse.ok || !sseResponse.body) {
      throw new Error(`Agent event stream failed (HTTP ${sseResponse.status}).`);
    }

    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let produced = false;
    let modelName: string | null = null;
    let toolHits = new Set<string>();
    let idle = false;
    let failed: Error | null = null;
    let promptSettled = false;
    const partTypes = new Map<string, string>();

    const readEvents = (async function* () {
      try {
        while (true) {
          // Stall breaker: once the prompt has settled, stop waiting for the
          // SSE stream if nothing arrives for 20s — the fallback below pulls
          // the finished message parts directly.
          const readPromise = reader.read();
          let value: Uint8Array | undefined;
          let done = false;
          if (promptSettled) {
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
            if (props.sessionID && props.sessionID !== session.id) continue;

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
                  yield encodeModelMarker(modelName ?? "qwen3.8-flash");
                  console.log(`[agent:${requestId}] first token (model ${modelName})`);
                }
                yield props.delta;
              }
            } else if (event.type === "message.part.updated") {
              const part = props.part;
              if (part?.id && part?.type) {
                partTypes.set(part.id, part.type);
              }
              if (part?.type === "tool" && !toolHits.has(part.tool ?? "")) {
                toolHits.add(part.tool ?? "");
                const label = part.state?.title || part.tool || "tool";
                yield encodeTryingMarker(`${label}`.slice(0, 60));
                console.log(`[agent:${requestId}] tool ${part.tool} (${part.state?.status})`);
              }
            } else if (event.type === "session.idle") {
              idle = true;
              break;
            }
          }
          if (idle) break;
        }
      } catch (error) {
        failed = error instanceof Error ? error : new Error(String(error));
      }
    })();

    // Wait for the prompt to settle, reading events concurrently. The
    // opencode server can hang instead of erroring when the subscription is
    // exhausted — enforce a hard timeout so callers can fall back.
    const promptPromise = Promise.race([
      agent.session.prompt({
        path: { id: session.id },
        body: {
          system,
          parts: [{ type: "text", text: buildTranscript(messages) }],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Agent prompt timed out after 180s.")),
          180_000
        )
      ),
    ]);

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

    // Wait for the prompt to settle, reading events concurrently.
    const promptResult = await promptPromise
      .then(
        (result) =>
          ({
            status: "ok" as const,
            info: (result as { data?: { info?: PromptInfo } }).data?.info,
          })
      )
      .catch((error: unknown) => {
        failed = error instanceof Error ? error : new Error(String(error));
        return { status: "error" as const, info: undefined };
      });
    promptSettled = true;
    for await (const text of readEvents) {
      yield text;
    }

    // Fallback: if the event stream never delivered the answer, pull the
    // finished message parts directly from the session.
    if (!produced && promptResult.status === "ok") {
      try {
        const list = (await agent.session.messages({
          path: { id: session.id },
        })) as {
          data?: {
            info?: { role?: string; modelID?: string };
            parts?: { type?: string; text?: string }[];
          }[];
        };
        const entries = list.data ?? [];
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.info?.role !== "assistant") continue;
          const textParts = (entry.parts ?? [])
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text as string);
          if (textParts.length === 0) continue;
          modelName = entry.info?.modelID ?? modelName;
          produced = true;
          yield encodeModelMarker(modelName ?? "qwen3.8-flash");
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
      insertCall({
        kind: "opencode",
        model: modelName ?? "qwen3.8-flash",
        ok: false,
        error: failure.message.slice(0, 300),
      }).catch(() => {});
      throw failure;
    }
    if (!produced && failed) {
      throw failed;
    }
    if (!produced) {
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
    insertCall({
      kind: "opencode",
      model: info?.modelID ?? modelName ?? "qwen3.8-flash",
      ok: true,
      cost: info?.cost,
      tokens: normalized,
    }).catch(() => {});
    console.log(
      `[agent:${requestId}] done — answered by agent (${info?.modelID ?? modelName ?? "default"}), cost ${info?.cost ?? "n/a"}`
    );
  } finally {
    agent.session.delete({ path: { id: session.id } }).catch(() => {});
  }
}
