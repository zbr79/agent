import { deleteAgentSession } from "./agent";
import {
  CheckpointConflictError,
  deleteCheckpointsForMessages,
  findRunCheckpointForMessage,
  restoreCheckpoint,
} from "./checkpoints";
import {
  getAgentBinding,
  getSessionWorkspace,
  setAgentBinding,
  truncateMessages,
} from "./db";

export { CheckpointConflictError };

export async function rewindSession(input: {
  userId: string;
  sessionId: string;
  keep: number;
  restoreMessageId?: string;
}): Promise<{ removed: number; restored: boolean }> {
  const workspaceId = await getSessionWorkspace(input.userId, input.sessionId);
  if (!workspaceId) {
    throw new Error("Session not found.");
  }

  let restored = false;
  if (input.restoreMessageId) {
    const target = await findRunCheckpointForMessage(
      input.userId,
      workspaceId,
      input.restoreMessageId,
      input.sessionId
    );
    if (target) {
      const result = await restoreCheckpoint(input.userId, target.id);
      if (!result) {
        throw new Error("The checkpoint could not be restored.");
      }
      if (result.preview.conflicts.length) {
        throw new CheckpointConflictError(result.preview);
      }
      restored = true;
    }
  }

  const truncated = await truncateMessages(input.userId, input.sessionId, input.keep);
  const binding = await getAgentBinding(input.userId, input.sessionId);
  if (binding) {
    await deleteAgentSession(binding.sessionId, binding.workspaceId);
  }
  await setAgentBinding(input.userId, input.sessionId, null);
  await deleteCheckpointsForMessages(
    input.userId,
    input.sessionId,
    truncated.removedIds
  );
  return { removed: truncated.removed, restored };
}
