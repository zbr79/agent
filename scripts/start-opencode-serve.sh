#!/bin/bash
# Pin opencode serve cwd to /home/ubuntu/agent (hard workspace jail).
set -euo pipefail
ENV_FILE="${OPENCODE_SERVER_ENV:-/home/ubuntu/opencode-tmp/agent/.server-env}"
WORKSPACE="${AGENT_WORKSPACE:-/home/ubuntu/agent}"
LOG_FILE="${OPENCODE_SERVER_LOG:-/home/ubuntu/opencode-tmp/agent/server.log}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export AGENT_WORKSPACE="$WORKSPACE"
cd "$WORKSPACE"
exec opencode serve --port 4096 >>"$LOG_FILE" 2>&1
