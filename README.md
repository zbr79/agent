# Agent

Agent is a streaming AI workspace built with Next.js. It supports ordinary
chat, multimodal attachments, web research, persistent sessions, and a
restricted coding-agent workflow.

**Live demo:** https://agent.rwkit.com

## What it demonstrates

- Streaming text responses with cancellation and retry handling
- Image uploads and document extraction for TXT, PDF, DOCX, and XLSX files
- Model selection with vision routing, fallback chains, and peak-hour handling
- OpenCode-backed web research with tool activity shown in the conversation
- Build mode and read-only Plan mode
- Guest sessions in browser storage and authenticated sessions in MongoDB
- Multiple workspaces with search, sharing, pinning, and session management
- Agent questions, streamed activity markers, and recovery after interrupted runs
- Checkpoint snapshots with conflict detection before restoring workspace files
- Optional local Whisper transcription for voice input
- English and Chinese UI translations

API keys stay on the server and are never sent to the browser.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- MongoDB for accounts, sessions, messages, usage, and sharing
- OpenCode Go through its OpenAI-compatible API
- Optional local OpenCode agent server for web research and multi-step work
- Optional local whisper.cpp server for speech-to-text
- Vitest for unit/API tests and Playwright for browser tests

The default text chain starts with `deepseek-v4-flash` and falls back through
compatible models. Image requests route to `glm-5.3-flash`. The available
catalog and routing rules live in `lib/models.ts`.

## Setup

Requirements: Node.js, npm, MongoDB for authenticated persistence, and an
OpenCode Go API key for live model responses.

```bash
npm install
cp .env.example .env
# edit .env with real credentials
npm run dev
```

For a production build:

```bash
npm run build
npm run start
```

Guest chat can be exercised locally without signing in, but accounts and
server-side session persistence require `MONGODB_URI`.

### Environment

The minimum `.env` values are:

```dotenv
OPENCODE_API_KEY=your_opencode_go_api_key_here
MONGODB_URI=mongodb+srv://user:pass@cluster.example.net
OPENCODE_SERVER_PASSWORD=your_opencode_server_password_here
```

Useful optional settings include `AGENT_DB`, `AGENT_DEFAULT_MODEL`,
`AGENT_WORKSPACE`, and `AGENT_CHECKPOINT_DIR`. Voice transcription uses the
`WHISPER_*` settings documented in `scripts/start-whisper.sh`.

Never commit `.env`, server passwords, API keys, model files, or MongoDB
credentials.

## Running the test suite

```bash
npm run test:unit       # Vitest unit and API tests
npm run test:e2e        # Playwright against a production build
npm run test:all        # unit tests followed by browser tests
npx tsc --noEmit        # TypeScript validation
npm run build           # production build
```

The browser tests mock external APIs so they are deterministic. The live
filesystem probes remain available for the security-sensitive subsystems:

```bash
node scripts/test-path-jail.mjs
npx tsx scripts/test-checkpoints.mts
```

GitHub Actions runs the type-check, unit/API tests, production build, and
Chromium Playwright suite on pushes and pull requests. External provider calls
are mocked in CI, so no API keys or database credentials are required.

## Production deployment

The included PM2 configuration runs the Next.js app on port `3002`:

```bash
npm run build
pm2 start ecosystem.config.js
```

The optional OpenCode sidecar runs on localhost port `4096`:

```bash
bash scripts/start-opencode-serve.sh
```

It is configured for web research permissions only. If the sidecar is
unavailable, the application falls back to its direct provider engine.

Voice input is an optional localhost Whisper sidecar on port `9081`. Install
it once with `bash scripts/install-whisper.sh`, then start it with
`bash scripts/start-whisper.sh`.

Place a reverse proxy in front of port `3002`. Streaming requires response
buffering to be disabled, for example nginx's `proxy_buffering off`.

## Request and recovery flow

1. The browser sends validated messages and attachments to `/api/chat`.
2. The server chooses the agent or direct-provider path and records the run.
3. Model output, tool activity, questions, and model markers stream back to
   the browser.
4. The client can stop a run, finalize a pending response, or recover after a
   disconnect.
5. Authenticated messages are persisted in MongoDB; guest sessions stay in
   browser storage.
6. Build-mode runs can create checkpoints. Restore operations compare current
   file hashes and refuse unsafe conflicting restores.

The filesystem jail restricts agent access to the configured workspace,
blocks traversal and symlink escapes, and denies common secret-file names.
The OpenCode sidecar separately denies shell and external-directory access.

## Project structure

```text
app/
  api/chat/                  streaming chat and cancellation
  api/auth/                  registration, login, profile, password changes
  api/sessions/              persistent sessions and messages
  api/checkpoints/           snapshot preview, restore, and deletion
  api/documents/             upload and text extraction
  api/search/                session search
  api/shares/                shareable session links
  api/usage/                 quota and usage information
components/
  ChatApp.tsx                conversation state and recovery
  Composer.tsx               text, image, document, and voice input
  Sidebar.tsx                workspaces and session management
  MessageBubble.tsx          markdown, activity, and checkpoint UI
lib/
  opencode.ts                provider and streaming integration
  models.ts                  catalog, routing, and fallback chains
  db.ts                      MongoDB persistence
  chatRequest.ts             request and attachment validation
  checkpointSnapshot.ts      safe workspace snapshot operations
  pathJail.ts                filesystem security boundary
scripts/
  start-opencode-serve.sh    OpenCode research sidecar
  start-whisper.sh           local transcription sidecar
  test-*.                    live security and checkpoint probes
tests/
  unit/                      core, API, persistence, and security tests
  e2e/                       mocked Playwright browser flows
```

## Interview demo path

1. Send a normal streaming message.
2. Switch models and show the model picker.
3. Upload a document and ask a question about its contents.
4. Open the authenticated session/account flow.
5. Show session persistence and workspace organization.
6. Explain the path jail and checkpoint conflict protection.
7. Run `npm run test:all` and `npx tsc --noEmit`.
