import { ObjectId } from "mongodb";
import { getUserFromRequest } from "@/lib/auth";
import {
  abortAgentSession,
  QuestionExpiredError,
  rejectAgentQuestion,
  replyAgentQuestion,
} from "@/lib/agent";
import {
  clearOwnedPendingQuestion,
  findOwnedPendingQuestion,
  isGuestSessionId,
} from "@/lib/db";
import {
  QuestionValidationError,
  validateQuestionAnswers,
} from "@/lib/question";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const action = body.action === "reject" ? "reject" : body.action === "reply" ? "reply" : "";
  const abort = body.abort === true;
  if (!sessionId || sessionId.length > 64 || !requestId || requestId.length > 80) {
    return Response.json({ error: "Invalid question request." }, { status: 400 });
  }
  if (action !== "reply" && action !== "reject") {
    return Response.json({ error: '"action" must be "reply" or "reject".' }, { status: 400 });
  }

  const user = await getUserFromRequest(req);
  let userId: string | null = null;
  if (ObjectId.isValid(sessionId)) {
    if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
    userId = user._id;
  } else if (!isGuestSessionId(sessionId)) {
    return Response.json({ error: "Invalid session." }, { status: 400 });
  }

  const found = await findOwnedPendingQuestion(sessionId, requestId, userId);
  if (!found) {
    return Response.json({ error: "This question expired." }, { status: 410 });
  }

  try {
    if (action === "reply") {
      const answers = validateQuestionAnswers(found.pending, body.answers);
      await replyAgentQuestion(requestId, answers, found.pending.opencodeSessionId);
    } else {
      try {
        await rejectAgentQuestion(requestId, found.pending.opencodeSessionId);
      } catch (error) {
        if (!(error instanceof QuestionExpiredError) || !abort) throw error;
      }
      if (abort) await abortAgentSession(found.pending.opencodeSessionId);
    }
  } catch (error) {
    if (error instanceof QuestionValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof QuestionExpiredError) {
      await clearOwnedPendingQuestion(sessionId, requestId, userId);
      return Response.json({ error: "This question expired." }, { status: 410 });
    }
    const message = error instanceof Error ? error.message : "Could not send the answer.";
    return Response.json({ error: message }, { status: 502 });
  }

  await clearOwnedPendingQuestion(sessionId, requestId, userId);
  return Response.json({ ok: true });
}
