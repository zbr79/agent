# InsChat

Minimalist AI chatbot — text chat + image upload, streaming responses. Powered by the **opencode-go subscription** (`https://opencode.ai/zen/go/v1`).

**Live:** https://inschat.renstoolbox.com

## Features

- Text chat with streaming responses
- Image upload (JPEG/PNG/WebP) — DeepSeek V4 Flash Vision Exp analyzes your photo
- Live web research: the model can fetch pages itself (`web_fetch` tool) for current prices, docs, news
- Multi-turn conversation (last 20 messages kept as context)
- Conclude button: extracts structured health data (insulin/glucose/meals) and saves records
- Model picker (`/models`), usage pages (`/usage`, `/opencode-calls`) with the official Go quota windows
- Apple-style black & white UI, mobile-friendly
- Server-side API key (never exposed to the client)

## Stack

Next.js 16 (App Router, React 19) + plain `fetch` against the opencode-go OpenAI-compatible API (no SDK). Models:

- Text chat: `deepseek-v4-pro`, falling back to `deepseek-v4-flash` (pinnable via the Models page)
- Images: `deepseek-v4-flash-vision-exp` (auto-routed whenever a photo is attached)
- Conclude: `deepseek-v4-flash` → `deepseek-v4-pro` chain (override via `CONCLUDE_MODEL`)

## Get an API key

1. Subscribe to OpenCode Go at https://opencode.ai/auth (the key is also stored locally at `~/.local/share/opencode/auth.json` → `opencode-go.key`).
2. Copy the key (starts with `sk-...`).

## Setup

```bash
npm install
cp .env.example .env
# edit .env: OPENCODE_API_KEY=sk-... (your key)
npm run dev        # development
# or production:
npm run build
npm run start      # serves on port 3000 by default
```

## Deploy with PM2

```bash
npm run build
pm2 start ecosystem.config.js   # serves on port 3001
```

Put nginx (or any reverse proxy) in front and proxy `/` to `127.0.0.1:3001`. If proxying, keep `proxy_buffering off;` so responses stream. Note: each new API route needs its own nginx `location` block (POST-only routes fall through `location /`, which only allows GET).

## How it works

1. Browser sends `POST /api/chat` with `{ messages: [{ role, text, image? }] }`.
2. Server validates the payload (roles, image type/size) and calls the opencode-go API with full history.
3. Tokens stream back; the server relays them chunk-by-chunk to the browser.
4. Images travel as base64 data-URLs in OpenAI `image_url` content blocks.

Quota: the Go plan is dollar-based ($12 per 5h, $30 per week, $60 per month). The app retries overloaded (503) calls up to 3 times with backoff and falls back along the model chain when a model fails.

## Project structure

```
app/
  api/chat/route.ts        # POST endpoint: validation + streaming relay
  api/conclude/route.ts    # POST: structured conclusion extraction
  api/opencode/route.ts    # POST: OpenCode-page chat (same engine)
  api/opencode-calls/      # GET: opencode call log + official quota
  api/models/              # GET/POST: catalog + active model
  api/health/              # GET: live per-model probe
  api/usage/               # GET: opencode usage + official quota windows
components/
  ChatApp.tsx              # client state: messages, streaming, abort
  MessageBubble.tsx        # message list + markdown rendering
  Composer.tsx             # text input + image upload + preview
  OpenCodeChat.tsx         # standalone DeepSeek chat page
  OpenCodeCallsPanel.tsx   # opencode call log + quota
  ModelsPanel.tsx          # model picker (opencode-go catalog)
  UsagePanel.tsx           # usage overview
lib/
  opencode.ts              # opencode-go client: streaming chains, quota, probes
  prompt.ts                # SYSTEM_PROMPT.md persona + timezone helpers
  models.ts                # opencode-go model catalog + chains
  conclude.ts              # structured conclusion extraction
  chatRequest.ts           # shared request validation
  db.ts                    # MongoDB (sessions, records, calls)
  types.ts                 # shared types + limits
```
