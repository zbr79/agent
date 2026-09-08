#!/bin/bash
# One-time setup for LOCAL voice dictation: builds whisper.cpp and downloads
# the large-v3-turbo (q8_0) model. Run as the ubuntu user on the VM:
#   bash /home/ubuntu/agent/scripts/install-whisper.sh
# Safe to re-run; already-done steps are skipped. ~1 GB disk, no keys needed.
set -euo pipefail

REPO_DIR="${HOME}/whisper.cpp"
MODEL_DIR="${HOME}/models"
MODEL_FILE="${MODEL_DIR}/ggml-large-v3-turbo-q8_0.bin"
MODEL_PATH="ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin"
THREADS="$( { t="$(nproc)"; if [ "$t" -gt 1 ]; then echo $((t - 1)); else echo 1; fi; } )"

echo "== 1/5 build tools"
missing=()
for b in git cmake make curl g++; do command -v "$b" >/dev/null 2>&1 || missing+=("$b"); done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "installing: ${missing[*]}"
  sudo apt-get update -y
  sudo apt-get install -y build-essential cmake git curl
fi

echo "== 2/5 whisper.cpp source"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$REPO_DIR"
else
  echo "already at $REPO_DIR"
fi

echo "== 3/5 compile whisper-server (CPU, takes a few minutes)"
cmake -S "$REPO_DIR" -B "$REPO_DIR/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_SERVER=ON
cmake --build "$REPO_DIR/build" -j"$(nproc)" --config Release --target whisper-server whisper-cli

echo "== 4/5 model (~834 MB, MIT weights, one file)"
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_FILE" ]; then
  echo "already downloaded"
else
  ok=0
  for host in huggingface.co hf-mirror.com; do
    echo "trying $host …"
    if curl -fL -C - --retry 3 -o "$MODEL_FILE" "https://${host}/${MODEL_PATH}"; then ok=1; break; fi
  done
  [ "$ok" = "1" ] || { echo "download failed from both hosts"; exit 1; }
fi

echo "== 5/5 benchmark (11 s English sample on ${THREADS} threads)"
cd "$REPO_DIR"
time (build/bin/whisper-cli -m "$MODEL_FILE" -f samples/jfk.wav -t "$THREADS" >/dev/null) || true

cat <<EOF

Done. Start the sidecar under PM2:

  cd /home/ubuntu/agent
  pm2 start scripts/start-whisper.sh --name whisper-stt
  pm2 save

Verify it answers:

  curl -sF file=@samples/jfk.wav http://127.0.0.1:9081/inference | head -c 200; echo

If wall clock > ~30x the clip length, swap to the smaller model in .server-env:
  WHISPER_MODEL=\$HOME/models/ggml-large-v3-turbo-q5_0.bin   (547 MB — re-download with _q5_0 name)
EOF
