import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGuestSessions,
  createGuestSession,
  getGuestSession,
  listGuestSessions,
  appendGuestMessage,
  pinGuestSession,
  renameGuestSession,
  setGuestConclusion,
  truncateGuestSession,
  deleteGuestSession,
} from "@/lib/guestStore";
import {
  getChangesOpen,
  getChatMode,
  getCompressImages,
  getSelectedModel,
  setChangesOpen,
  setChatMode,
  setCompressImages,
  setSelectedModel,
} from "@/lib/prefs";
import { authCookie, clearAuthCookie, requireUser } from "@/lib/auth";
import { listWorkspaceInfo, requireWorkspace } from "@/lib/workspaces";
import { modelLabel } from "@/lib/modelLabels";
import { toWorkspaceRelative } from "@/lib/workspacePath";

function installWindowStorage() {
  const values = new Map<string, string>();
  const target = new EventTarget();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(target, { localStorage }),
  });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "window");
});

describe("browser preferences", () => {
  it("persists compression, model, mode, and changes settings", () => {
    const storage = installWindowStorage();
    expect(getCompressImages()).toBe(true);
    setCompressImages(false);
    expect(getCompressImages()).toBe(false);
    setSelectedModel("glm-5.3-flash");
    expect(getSelectedModel()).toBe("glm-5.3-flash");
    setChatMode("plan");
    expect(getChatMode()).toBe("plan");
    expect(getChangesOpen()).toBe(false);
    setChangesOpen(true);
    expect(getChangesOpen()).toBe(true);
    expect(storage.length).toBe(4);
  });
});

describe("guest session persistence", () => {
  it("creates, edits, truncates, and deletes guest sessions", () => {
    installWindowStorage();
    const session = createGuestSession("New chat");
    appendGuestMessage(session.id, { role: "user", text: "hello" });
    appendGuestMessage(session.id, { role: "model", text: "hi" });
    renameGuestSession(session.id, "Renamed");
    pinGuestSession(session.id, true);
    setGuestConclusion(session.id, {
      title: "Summary",
      summary: "Done",
      items: [],
    } as never, "record-1");

    const saved = getGuestSession(session.id)!;
    expect(saved.title).toBe("Renamed");
    expect(saved.pinned).toBe(true);
    expect(saved.messages).toHaveLength(2);
    expect(saved.recordId).toBe("record-1");
    expect(saved.conclusion?.title).toBe("Summary");

    truncateGuestSession(session.id, 1);
    expect(getGuestSession(session.id)?.messages).toHaveLength(1);
    expect(getGuestSession(session.id)?.conclusion).toBeNull();
    expect(listGuestSessions()).toHaveLength(1);
    deleteGuestSession(session.id);
    expect(listGuestSessions()).toEqual([]);
    clearGuestSessions();
  });
});

describe("workspace, labels, and auth boundaries", () => {
  it("filters guest workspaces and rejects unknown workspaces", () => {
    expect(listWorkspaceInfo(true)).toEqual([{ id: "agent", label: "Agent" }]);
    expect(listWorkspaceInfo(false, ["rencipe", "agent"])[0].id).toBe("rencipe");
    expect(() => requireWorkspace("missing")).toThrow("Unknown workspace");
  });

  it("formats paths and model labels for user-visible output", () => {
    expect(toWorkspaceRelative("/home/ubuntu/agent/lib/prompt.ts")).toBe("lib/prompt.ts");
    expect(toWorkspaceRelative("plain text")).toBe("plain text");
    expect(modelLabel("qwen3.8-flash")).toBe("Qwen3.8 Flash");
    expect(modelLabel("future-model")).toBe("future-model");
  });

  it("creates secure cookie attributes and protects unauthenticated requests", async () => {
    expect(authCookie("token")).toContain("inschat_token=token");
    expect(authCookie("token")).toContain("HttpOnly");
    expect(authCookie("token")).toContain("SameSite=Lax");
    expect(clearAuthCookie()).toContain("Max-Age=0");
    const response = await requireUser(new Request("http://test"));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });
});
