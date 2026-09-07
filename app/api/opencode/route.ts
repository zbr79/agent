import { ChatValidationError } from "@/lib/errors";
import { parseChatBody, type ChatRequest } from "@/lib/chatRequest";
import {
  chatErrorMessage,
  isBalanceError,
  quotaResetInfo,
} from "@/lib/opencode";
import { agentChat, isAgentUp } from "@/lib/agent";
import { encodeLimitMarker } from "@/lib/markers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let parsed: ChatRequest;
  try {
    parsed = parseChatBody(await req.json());
  } catch (error) {
    const message =
      error instanceof ChatValidationError
        ? error.message
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }
  const { messages, timeZone, language, mode } = parsed;
  const freeMode = mode === "free";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", () => {
        console.log("[opencode] client disconnected mid-stream");
      });
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        // OpenCode UI needs filesystem tools from local opencode serve (:4096).
        // Do not fall back to the remote zen path (web_fetch only) — that
        // falsely implies the agent cannot read/edit project files.
        const agentReady = await isAgentUp();
        if (!agentReady) {
          const msg =
            language === "en"
              ? "Local OpenCode agent server is unavailable (expected on 127.0.0.1:4096). Filesystem tools (read/edit) need inschat-agent running — start it, then retry. This UI does not use the remote web_fetch-only path."
              : "本地 OpenCode agent 服务不可用（需要 127.0.0.1:4096）。读写项目文件依赖 inschat-agent，请启动后再试。此页面不会回退到仅有 web_fetch 的远程路径。";
          enqueue(`\n\n[${msg}]`);
          return;
        }
        for await (const text of agentChat(
          messages,
          timeZone,
          language,
          freeMode,
          true
        )) {
          enqueue(text);
        }
      } catch (error) {
        const message =
          error instanceof ChatValidationError
            ? error.message
            : await chatErrorMessage(error, language);
        if (!(error instanceof ChatValidationError) && isBalanceError(error)) {
          const { window, resetAt } = await quotaResetInfo();
          if (resetAt) enqueue(encodeLimitMarker(`${window}|${resetAt}`));
        }
        enqueue(`\n\n[${message}]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
