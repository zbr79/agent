import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  appendMessage: vi.fn(),
  deleteSession: vi.fn(),
  finalizePendingMessage: vi.fn(),
  getAgentBinding: vi.fn(),
  getSessionWithMessages: vi.fn(),
  getSessionWorkspace: vi.fn(),
  insertSession: vi.fn(),
  listSessions: vi.fn(),
  setSessionConclusion: vi.fn(),
  setSessionPinned: vi.fn(),
  setSessionRecordId: vi.fn(),
  setSessionTitle: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({
  deleteAgentSession: vi.fn(),
}));

vi.mock("@/lib/rewind", () => ({
  CheckpointConflictError: class CheckpointConflictError extends Error {
    preview: unknown;
    constructor(preview: unknown) {
      super("checkpoint conflict");
      this.preview = preview;
    }
  },
  rewindSession: vi.fn(),
}));

import { GET as listGet, POST as listPost } from "@/app/api/sessions/route";
import {
  DELETE as sessionDelete,
  GET as sessionGet,
  PUT as sessionPut,
} from "@/app/api/sessions/[id]/route";
import { POST as messagePost } from "@/app/api/sessions/[id]/messages/route";
import { requireUser } from "@/lib/auth";
import {
  appendMessage,
  deleteSession,
  finalizePendingMessage,
  getAgentBinding,
  getSessionWithMessages,
  insertSession,
  listSessions,
  setSessionConclusion,
  setSessionPinned,
  setSessionTitle,
} from "@/lib/db";
import { deleteAgentSession } from "@/lib/agent";
import { rewindSession } from "@/lib/rewind";

const user = {
  _id: "507f1f77bcf86cd799439011",
  username: "alice",
  displayName: "Alice",
};

const session = {
  id: "session-1",
  title: "Existing",
  workspaceId: "agent",
  updatedAt: 1,
  messages: [],
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(listSessions).mockResolvedValue([session] as never);
  vi.mocked(insertSession).mockResolvedValue(session as never);
  vi.mocked(getSessionWithMessages).mockResolvedValue({
    session,
    messages: [],
  } as never);
  vi.mocked(setSessionTitle).mockResolvedValue(true);
  vi.mocked(setSessionPinned).mockResolvedValue(true);
  vi.mocked(setSessionConclusion).mockResolvedValue(true);
  vi.mocked(getAgentBinding).mockResolvedValue({
    sessionId: "agent-session",
    workspaceId: "agent",
  } as never);
  vi.mocked(deleteSession).mockResolvedValue(true);
  vi.mocked(rewindSession).mockResolvedValue({
    removed: [],
    restored: null,
  } as never);
  vi.mocked(appendMessage).mockResolvedValue({
    id: "message-1",
    role: "user",
    text: "hello",
  } as never);
  vi.mocked(finalizePendingMessage).mockResolvedValue(true);
});

describe("session routes", () => {
  it("lists and creates sessions with workspace validation", async () => {
    const listed = await listGet(
      new Request("http://test/api/sessions?workspaceId=agent")
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).sessions).toEqual([session]);
    expect(listSessions).toHaveBeenCalledWith(user._id, 50, "agent");

    const invalid = await listGet(
      new Request("http://test/api/sessions?workspaceId=missing")
    );
    expect(invalid.status).toBe(400);

    const created = await listPost(
      jsonRequest("http://test/api/sessions", {
        title: "  New task  ",
        workspaceId: "agent",
      })
    );
    expect(created.status).toBe(201);
    expect(insertSession).toHaveBeenCalledWith(user._id, "New task", "agent");
  });

  it("rejects oversized session titles before database writes", async () => {
    const response = await listPost(
      jsonRequest("http://test/api/sessions", { title: "x".repeat(121) })
    );
    expect(response.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("loads and updates a session", async () => {
    const params = { params: Promise.resolve({ id: "session-1" }) };
    const loaded = await sessionGet(new Request("http://test/api/sessions/session-1"), params);
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).session).toEqual(session);

    expect(
      (await sessionPut(
        jsonRequest("http://test/api/sessions/session-1", { title: "Renamed" }, "PUT"),
        params
      )).status
    ).toBe(200);
    expect(setSessionTitle).toHaveBeenCalledWith(user._id, "session-1", "Renamed");

    await sessionPut(
      jsonRequest("http://test/api/sessions/session-1", { pinned: true }, "PUT"),
      params
    );
    expect(setSessionPinned).toHaveBeenCalledWith(user._id, "session-1", true);

    await sessionPut(
      jsonRequest("http://test/api/sessions/session-1", {
        conclusion: { title: "Done", summary: "Summary", items: [] },
      }, "PUT"),
      params
    );
    expect(setSessionConclusion).toHaveBeenCalled();
  });

  it("appends messages and rejects malformed message payloads", async () => {
    const params = { params: Promise.resolve({ id: "session-1" }) };
    const response = await messagePost(
      jsonRequest("http://test/api/sessions/session-1/messages", {
        role: "user",
        text: "hello",
        model: "qwen3.8-flash",
        elapsed: 1.5,
      }),
      params
    );
    expect(response.status).toBe(201);
    expect(appendMessage).toHaveBeenCalledWith(user._id, "session-1", expect.objectContaining({
      role: "user",
      text: "hello",
      model: "qwen3.8-flash",
      elapsed: 1.5,
    }));

    const invalid = await messagePost(
      jsonRequest("http://test/api/sessions/session-1/messages", {
        role: "not-a-role",
        text: "hello",
      }),
      params
    );
    expect(invalid.status).toBe(400);

    const duplicate = await messagePost(
      jsonRequest("http://test/api/sessions/session-1/messages", {
        role: "user",
        text: "with duplicate files",
        images: [
          { name: "photo.png", mimeType: "image/png", data: "a" },
          { name: " PHOTO.PNG ", mimeType: "image/png", data: "b" },
        ],
      }),
      params
    );
    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).error).toContain("duplicate");

    const finalized = await messagePost(
      jsonRequest("http://test/api/sessions/session-1/messages", {
        finalizePending: true,
        messageId: "pending-1",
        text: "complete",
        elapsed: 4,
      }),
      params
    );
    expect(finalized.status).toBe(200);
    expect(finalizePendingMessage).toHaveBeenCalledWith(
      user._id,
      "session-1",
      "pending-1",
      { text: "complete", elapsed: 4 }
    );
  });

  it("deletes a session and its agent binding", async () => {
    const response = await sessionDelete(
      new Request("http://test/api/sessions/session-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "session-1" }) }
    );
    expect(response.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith(user._id, "session-1");
    expect(deleteAgentSession).toHaveBeenCalledWith("agent-session", "agent");
  });
});
