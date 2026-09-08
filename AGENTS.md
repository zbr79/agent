# Agent

Workspace: /home/ubuntu/agent
PM2 app: agent on 3002
Opencode: inschat-agent on 4096 via scripts/start-opencode-serve.sh
Jail: lib/pathJail.ts
Opencode perms: read/edit/list/glob/grep allow inside workspace; bash deny-by-default with allowlist for build, restart, and repo commit/origin when asked; external_directory deny; secrets deny
After build: DONE text first, then deferred recycle script. Treat script exit as success.
Test: node scripts/test-path-jail.mjs
Site: https://agent.renstoolbox.com
Remote: zbr79/agent
