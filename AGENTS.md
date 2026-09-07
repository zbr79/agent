# Agent

Workspace: /home/ubuntu/agent
PM2 app: agent on 3002
Opencode: inschat-agent on 4096 via scripts/start-opencode-serve.sh
Jail: lib/pathJail.ts
Opencode perms: read/edit/list/glob/grep allow inside workspace; bash deny-by-default with build-only allowlist; external_directory deny; secrets deny
After a successful `npm run build`, send final reply FIRST, then run `bash scripts/restart-agent-deferred.sh` so users see changes live. The script sleeps ~10s then runs `pm2 restart agent` only -- the delay lets the HTTP stream finish DONE and avoids mid-stream network errors and 502s. Never schedule a deferred recycle before the final reply is streamed. Never run `pm2 restart all`, and do not run bare synchronous `pm2 restart agent` mid-request.
Test: node scripts/test-path-jail.mjs
Site: https://agent.renstoolbox.com
Remote: zbr79/agent
