#!/bin/bash
# Schedule a deferred restart of the Next.js agent app so the current HTTP
# response can finish (DONE text + stream close) before pm2 recycles.
# IMPORTANT: exit 0 immediately after scheduling — never sleep in the
# foreground. A foreground sleep kept the agent turn open until pm2 killed
# Next mid-stream, and the client painted Interrupted even when the build
# succeeded.
set -euo pipefail
export PATH=/home/ubuntu/.nvm/versions/node/v22.21.1/bin:/usr/bin:/bin

# Delay the pm2 recycle long enough for the agent's closing summary to stream
# out after this tool call (the old 1s default cut off the conclusion, and the
# SIGTERM flush persisted a reply truncated at the restart line).
DELAY_SEC="${RESTART_DELAY_SEC:-25}"
LOG=/tmp/agent-deferred-restart.log

nohup bash -c "echo \"[\$(date -Is)] Restart of pm2 app agent in ${DELAY_SEC}s...\"; sleep ${DELAY_SEC}; pm2 restart agent; echo \"[\$(date -Is)] pm2 restart agent done\"" >>"$LOG" 2>&1 &
disown 2>/dev/null || true
echo "Restart of pm2 app \"agent\" scheduled in ${DELAY_SEC}s (detached; log $LOG). Treat this tool exit as success."
exit 0
