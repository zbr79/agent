# Agent

Workspace: /home/ubuntu/agent
PM2 app: agent on 3002
Opencode: inschat-agent on 4096 via scripts/start-opencode-serve.sh
Jail: lib/pathJail.ts
Opencode perms: read/edit/list/glob/grep allow inside workspace only; bash+external_directory deny; .env/.server-env/keys deny
Test: node scripts/test-path-jail.mjs
Site: https://agent.renstoolbox.com
Remote: zbr79/agent
