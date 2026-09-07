#!/bin/bash
# Deferred restart of the Next.js agent app so the current request can finish
# before pm2 recycles the process (avoids mid-request 502s).
set -euo pipefail
export PATH=/home/ubuntu/.nvm/versions/node/v22.21.1/bin:/usr/bin:/bin
echo "Restart of pm2 app \"agent\" scheduled in 10s (deferred to avoid 502)..."
sleep 10
pm2 restart agent
