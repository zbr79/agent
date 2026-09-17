#!/bin/bash
# Schedule a deferred restart of the Next.js agent app.
# IMPORTANT: exit 0 immediately after scheduling — never sleep in the
# foreground. A foreground sleep kept the agent turn open until pm2 killed
# Next mid-stream, and the client painted Interrupted even when the build
# succeeded.
#
# Recycle waits until:
#   1. A short flush so the scheduling turn can stream DONE
#   2. No /api/chat runs are in flight (so Commit & push after a build is not killed)
# One waiter is enough: later schedule calls only bump the request timestamp.
set -euo pipefail
export PATH=/home/ubuntu/.nvm/versions/node/v22.21.1/bin:/usr/bin:/bin

FLUSH_SEC="${RESTART_FLUSH_SEC:-2}"
IDLE_SEC="${RESTART_IDLE_SEC:-2}"
MAX_WAIT_SEC="${RESTART_MAX_WAIT_SEC:-180}"
LOG=/tmp/agent-deferred-restart.log
LOCK=/tmp/agent-deferred-restart.lock
REQUEST=/tmp/agent-restart-requested
INFLIGHT_DIR=/tmp/agent-inflight-chats

now_epoch() { date +%s; }

date +%s >"$REQUEST"

wait_for_restart() {
  exec 9>"$LOCK"
  if ! flock -n 9; then
    echo "[$(date -Is)] Restart already waiting; request timestamp updated."
    return 0
  fi

  local started idle=0
  started="$(now_epoch)"
  while true; do
    local requested
    requested="$(cat "$REQUEST" 2>/dev/null || echo "$started")"
    local now
    now="$(now_epoch)"
    if (( now - started > MAX_WAIT_SEC )); then
      echo "[$(date -Is)] Max wait ${MAX_WAIT_SEC}s reached; restarting anyway."
      break
    fi
    if (( now < requested + FLUSH_SEC )); then
      sleep 1
      continue
    fi

    mkdir -p "$INFLIGHT_DIR"
    local token pid live=0
    shopt -s nullglob
    for token in "$INFLIGHT_DIR"/*; do
      pid="${token##*/}"
      pid="${pid%%-*}"
      if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        live=$((live + 1))
      else
        rm -f "$token"
      fi
    done
    shopt -u nullglob

    if (( live > 0 )); then
      echo "[$(date -Is)] Waiting for ${live} in-flight chat(s)…"
      idle=0
      sleep 1
      continue
    fi
    idle=$((idle + 1))
    if (( idle < IDLE_SEC )); then
      sleep 1
      continue
    fi
    break
  done

  local seen
  seen="$(cat "$REQUEST" 2>/dev/null || true)"
  echo "[$(date -Is)] pm2 restart agent"
  pm2 restart agent
  echo "[$(date -Is)] pm2 restart agent done"

  local after
  after="$(cat "$REQUEST" 2>/dev/null || true)"
  if [[ -n "$after" && "$after" != "$seen" ]]; then
    echo "[$(date -Is)] Another restart was requested during recycle; looping."
    flock -u 9
    exec bash "$0" --waiter
  fi
}

if [[ "${1:-}" == "--waiter" ]]; then
  wait_for_restart >>"$LOG" 2>&1
  exit 0
fi

nohup bash "$0" --waiter >>"$LOG" 2>&1 &
disown 2>/dev/null || true
echo "Restart of pm2 app \"agent\" scheduled when chats go idle (detached; log $LOG). Treat this tool exit as success."
exit 0
