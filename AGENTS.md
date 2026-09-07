# Agent

Workspace: /home/ubuntu/agent
PM2 app: agent on 3002
Opencode: inschat-agent on 4096 via scripts/start-opencode-serve.sh
Jail: lib/pathJail.ts
Opencode perms: read/edit/list/glob/grep allow inside workspace; bash deny-by-default with build-only allowlist; external_directory deny; secrets deny
After a production build: do NOT restart Next yourself. Ask the user to have Grok or an admin restart the agent process, or tell the user to restart manually.
Note: tool-driven agent process restart is forbidden because it interrupts live requests for users.
Test: node scripts/test-path-jail.mjs
Site: https://agent.renstoolbox.com
Remote: zbr79/agent
