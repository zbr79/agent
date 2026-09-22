import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getGuestAgentBinding: vi.fn(),
  getSessionWorkspace: vi.fn(),
  getWorkspaceOrder: vi.fn(),
  setWorkspaceOrder: vi.fn(),
  cancelPendingGuestRun: vi.fn(),
  cancelPendingMessages: vi.fn(),
  isGuestSessionId: (id: string) => id === "guest-session-1",
}));

vi.mock("@/lib/checkpoints", () => ({
  deleteCheckpoint: vi.fn(),
  getCheckpointPreview: vi.fn(),
  getRestoreConflictPreview: vi.fn(),
  listCheckpoints: vi.fn(),
  restoreCheckpoint: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({
  abortAgentSession: vi.fn(),
  abortAgentTurn: vi.fn(),
}));

import { GET as checkpointsGet } from "@/app/api/checkpoints/route";
import {
  DELETE as checkpointDelete,
  GET as checkpointPreviewGet,
} from "@/app/api/checkpoints/[id]/route";
import { POST as checkpointRestorePost } from "@/app/api/checkpoints/[id]/restore/route";
import { GET as workspacesGet } from "@/app/api/workspaces/route";
import { POST as workspaceOrderPost } from "@/app/api/workspaces/order/route";
import { POST as stopPost } from "@/app/api/chat/stop/route";
import { getUserFromRequest, requireUser } from "@/lib/auth";
import { abortAgentTurn } from "@/lib/agent";
import {
  cancelPendingGuestRun,
  getGuestAgentBinding,
  getWorkspaceOrder,
  setWorkspaceOrder,
} from "@/lib/db";
import {
  deleteCheckpoint,
  getCheckpointPreview,
  getRestoreConflictPreview,
  listCheckpoints,
  restoreCheckpoint,
} from "@/lib/checkpoints";

const user = {
  _id: "507f1f77bcf86cd799439011",
  username: "alice",
  displayName: "Alice",
};

const preview = {
  checkpoint: {
    id: "checkpoint-1",
    workspaceId: "agent",
    reason: "Before run",
    kind: "run",
    status: "ready",
    createdAt: "2026-09-22T00:00:00.000Z",
    changedCount: 1,
  },
  changes: [],
  conflicts: [],
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
  vi.mocked(getUserFromRequest).mockResolvedValue(user);
  vi.mocked(getWorkspaceOrder).mockResolvedValue(["agent"]);
  vi.mocked(setWorkspaceOrder).mockResolvedValue(undefined);
  vi.mocked(listCheckpoints).mockResolvedValue([preview.checkpoint] as never);
  vi.mocked(getCheckpointPreview).mockResolvedValue(preview as never);
  vi.mocked(deleteCheckpoint).mockResolvedValue(true);
  vi.mocked(getRestoreConflictPreview).mockResolvedValue(preview as never);
  vi.mocked(restoreCheckpoint).mockResolvedValue({
    preview,
    safety: null,
  } as never);
  vi.mocked(getGuestAgentBinding).mockResolvedValue(null);
  vi.mocked(cancelPendingGuestRun).mockResolvedValue(true);
});

describe("workspace and checkpoint routes", () => {
  it("returns workspace order and normalizes a submitted order", async () => {
    const response = await workspacesGet(new Request("http://test/api/workspaces"));
    expect(response.status).toBe(200);
    expect((await response.json()).workspaces[0]).toEqual({
      id: "agent",
      label: "Agent",
    });

    const saved = await workspaceOrderPost(
      jsonRequest("http://test/api/workspaces/order", {
        order: ["rencipe", "rencipe", "invalid", "agent"],
      })
    );
    expect(saved.status).toBe(200);
    expect(setWorkspaceOrder).toHaveBeenCalledWith(user._id, ["rencipe", "agent"]);
  });

  it("lists, previews, and deletes owned checkpoints", async () => {
    const listed = await checkpointsGet(
      new Request("http://test/api/checkpoints?workspace=agent&messageId=m1")
    );
    expect(listed.status).toBe(200);
    expect(listCheckpoints).toHaveBeenCalledWith(user._id, "agent", "m1");

    const params = { params: Promise.resolve({ id: "checkpoint-1" }) };
    expect(
      (await checkpointPreviewGet(new Request("http://test/api/checkpoints/checkpoint-1"), params))
        .status
    ).toBe(200);
    expect(
      (await checkpointDelete(
        new Request("http://test/api/checkpoints/checkpoint-1", { method: "DELETE" }),
        params
      )).status
    ).toBe(200);
    expect(deleteCheckpoint).toHaveBeenCalledWith(user._id, "checkpoint-1");

    const invalidWorkspace = await checkpointsGet(
      new Request("http://test/api/checkpoints?workspace=missing")
    );
    expect(invalidWorkspace.status).toBe(400);
  });

  it("requires explicit restore confirmation and restores conflict-free checkpoints", async () => {
    const params = { params: Promise.resolve({ id: "checkpoint-1" }) };
    const missingConfirmation = await checkpointRestorePost(
      new Request("http://test/api/checkpoints/checkpoint-1", { method: "POST" }),
      params
    );
    expect(missingConfirmation.status).toBe(400);
    expect(restoreCheckpoint).not.toHaveBeenCalled();

    const restored = await checkpointRestorePost(
      jsonRequest("http://test/api/checkpoints/checkpoint-1", { confirm: true }),
      params
    );
    expect(restored.status).toBe(200);
    expect(restoreCheckpoint).toHaveBeenCalledWith(user._id, "checkpoint-1");

    vi.mocked(getRestoreConflictPreview).mockResolvedValueOnce({
      ...preview,
      conflicts: [{ path: "README.md", conflict: true }],
    } as never);
    const conflict = await checkpointRestorePost(
      jsonRequest("http://test/api/checkpoints/checkpoint-1", { confirm: true }),
      params
    );
    expect(conflict.status).toBe(409);
    expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
  });
});

describe("chat stop route", () => {
  it("rejects malformed IDs and cancels guest runs", async () => {
    const invalid = await stopPost(
      jsonRequest("http://test/api/chat/stop", { sessionId: "bad" })
    );
    expect(invalid.status).toBe(400);

    const stopped = await stopPost(
      jsonRequest("http://test/api/chat/stop", {
        sessionId: "guest-session-1",
        workspaceId: "agent",
      })
    );
    expect(stopped.status).toBe(200);
    expect((await stopped.json()).canceled).toBe(1);
    expect(abortAgentTurn).toHaveBeenCalledWith("g:guest-session-1", "agent");
    expect(cancelPendingGuestRun).toHaveBeenCalledWith("guest-session-1");
  });
});
