// Client-safe twin of AGENT_ROOT (lib/pathJail.ts imports node:fs and must
// never be pulled into browser bundles). Models habitually echo absolute jail
// paths in their answers; user-visible surfaces strip them to workspace-
// relative paths so replies read like "lib/prompt.ts", not a filesystem dump.
export const WORKSPACE_ROOT = "/home/ubuntu/agent";

export function toWorkspaceRelative(text: string): string {
  if (!text || !text.includes(WORKSPACE_ROOT)) return text;
  return text
    .replaceAll(`${WORKSPACE_ROOT}/`, "")
    .replaceAll(WORKSPACE_ROOT, ".");
}
