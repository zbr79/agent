# GemChat

Minimalist AI chatbot — text chat + image upload, streaming responses. Powered by the **Google Gemini API free tier** (no credit card).

## Features

- Text chat with streaming responses
- Image upload (JPEG/PNG/WebP) — Gemini vision analyzes or describes your photo
- Multi-turn conversation (last 20 messages kept as context)
- Apple-style black & white UI, mobile-friendly
- Server-side API key (never exposed to the client)

## Stack

Next.js 16 (App Router, React 19) + `@google/genai` SDK. Model: `gemini-2.5-flash` (configurable via `GEMINI_MODEL`).

## Get an API key (free, ~2 minutes)

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** → **Create API key in new project**.
3. Copy the key (starts with `AIza...`).

## Setup

```bash
npm install
cp .env.example .env
# edit .env: GEMINI_API_KEY=AIza... (your key)
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

Put nginx (or any reverse proxy) in front and proxy `/` to `127.0.0.1:3001`. If proxying, keep `proxy_buffering off;` so responses stream.

## How it works

1. Browser sends `POST /api/chat` with `{ messages: [{ role, text, image? }] }`.
2. Server validates the payload (roles, image type/size) and calls Gemini with full history.
3. Gemini streams tokens back; the server relays them chunk-by-chunk to the browser.
4. Images travel as base64 `inlineData` parts.

Free-tier limits (Gemini, as of 2026): ~15 req/min on Pro models, ~60 req/min on Flash — fine for demos and small teams.

## Project structure

```
app/
  api/chat/route.ts   # POST endpoint: validation + streaming relay
  page.tsx            # server component entry
  layout.tsx          # metadata
  globals.css         # Apple-style black & white theme
components/
  ChatApp.tsx         # client state: messages, streaming, abort
  MessageBubble.tsx   # message list + markdown rendering
  Composer.tsx        # text input + image upload + preview
lib/
  gemini.ts           # Gemini SDK wrapper + payload conversion
  types.ts            # shared types + limits
```
