import fs from "node:fs";
import path from "node:path";

export const CHAT_INFLIGHT_DIR = "/tmp/agent-inflight-chats";

function tokenPath(): string {
  const id = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(CHAT_INFLIGHT_DIR, id);
}

/** Mark this process as serving a chat run. Call the returned function when the run ends. */
export function beginChatRun(): () => void {
  fs.mkdirSync(CHAT_INFLIGHT_DIR, { recursive: true, mode: 0o700 });
  const token = tokenPath();
  fs.writeFileSync(token, String(Date.now()), { mode: 0o600 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      fs.unlinkSync(token);
    } catch {
      /* already gone */
    }
  };
}
