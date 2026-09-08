#!/bin/bash
# Local STT sidecar (whisper.cpp server). PM2 name: whisper-stt.
# Binds 127.0.0.1 only — the Next route at /api/transcribe is the sole client.
set -euo pipefail
ENV_FILE="${OPENCODE_SERVER_ENV:-/home/ubuntu/opencode-tmp/agent/.server-env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

BIN="${WHISPER_BIN:-$HOME/whisper.cpp/build/bin/whisper-server}"
# English dictation only. large-v3-turbo is too slow for the mic button.
MODEL="${WHISPER_MODEL:-$HOME/models/ggml-tiny.en-q5_1.bin}"
case "$MODEL" in
  *large-v3-turbo*)
    echo "refusing slow turbo weights; using ggml-tiny.en-q5_1.bin" >&2
    MODEL="$HOME/models/ggml-tiny.en-q5_1.bin"
    ;;
esac
PORT="${WHISPER_PORT:-9081}"
# Use every core. Leaving one free forced -t 1 on this 2-vCPU box.
THREADS="${WHISPER_THREADS:-$(nproc)}"
if [[ "$THREADS" -lt 1 ]]; then THREADS=1; fi
LOG_FILE="${WHISPER_LOG:-/home/ubuntu/opencode-tmp/agent/whisper.log}"
mkdir -p "$(dirname "$LOG_FILE")"

[[ -x "$BIN" ]] || { echo "whisper-server not built: $BIN (run scripts/install-whisper.sh)" >&2; exit 1; }
[[ -f "$MODEL" ]] || { echo "model missing: $MODEL (run scripts/install-whisper.sh)" >&2; exit 1; }

exec "$BIN" -m "$MODEL" --host 127.0.0.1 --port "$PORT" -t "$THREADS" >>"$LOG_FILE" 2>&1
