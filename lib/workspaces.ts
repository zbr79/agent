import path from "node:path";
import { assertAgentWorkspaceReady } from "./pathJail";
import type { WorkspaceId, WorkspaceInfo } from "./types";

interface WorkspaceDefinition extends WorkspaceInfo {
  root: string;
}

const DEFINITIONS: WorkspaceDefinition[] = [
  { id: "agent", label: "Agent", root: "/home/ubuntu/agent" },
  { id: "profile", label: "Profile", root: "/home/ubuntu/Profile" },
  { id: "inschat", label: "Inschat", root: "/home/ubuntu/inschat" },
  { id: "rencipe", label: "Rencipe", root: "/home/ubuntu/rencipe" },
];

const BY_ID = new Map(DEFINITIONS.map((workspace) => [workspace.id, workspace]));

export const DEFAULT_WORKSPACE_ID: WorkspaceId = "agent";

export function getWorkspaceDefinition(id: unknown): WorkspaceDefinition | null {
  if (typeof id !== "string") return null;
  return BY_ID.get(id as WorkspaceId) ?? null;
}

export function requireWorkspace(id: unknown): WorkspaceDefinition {
  const workspace = getWorkspaceDefinition(id);
  if (!workspace) throw new Error("Unknown workspace.");
  return workspace;
}

export function listWorkspaceInfo(guest = false): WorkspaceInfo[] {
  return DEFINITIONS
    .filter((workspace) => !guest || workspace.id === DEFAULT_WORKSPACE_ID)
    .map(({ id, label }) => ({ id, label }));
}

export function workspaceRoot(id: unknown): string {
  return assertAgentWorkspaceReady(requireWorkspace(id).root);
}

export function workspacePath(id: unknown, relativePath = "."): string {
  const root = workspaceRoot(id);
  return path.resolve(root, relativePath);
}
